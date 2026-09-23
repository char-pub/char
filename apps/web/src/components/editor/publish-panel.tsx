/**
 * 发布对话框：选择版本号与可见性，然后依次保存草稿 → 生成 Revision（快照）→ 发布并等待
 * worker 检查依赖和许可 → 完成，每一步都显示进度。网络中断后重试会复用同一个
 * Idempotency-Key，不会重复发布；Publish Report 每秒轮询一次，最多 90 次。
 *
 * 结果留在对话框里：成功时显示许可检查、警告和锁定的依赖；失败时用人话解释原因并给出错误码，
 * 问题出在依赖上时可以直接跳到 Dependencies。
 */
import { type CheckDiagnostic, LABEL_RE, type ReferenceEdge } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Circle,
  CircleCheck,
  Loader2,
  Network,
  Rocket,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { ChoiceCard } from "@/components/choice-card";
import {
  explainIssue,
  IssueBox,
  type IssueContext,
  PublishReport,
} from "@/components/publish-report";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type CreationDetail, isApiError, type PublishReportResponse } from "@/lib/api";
import { IdempotencyKeys, suggestLabel, waitForReport } from "@/lib/publish";
import { noteApiError } from "@/lib/read-only";
import { keys, useRegistry } from "@/lib/registry";
import { parseRef } from "@/lib/text";
import { cn } from "@/lib/utils";

export const PUBLISH_STEPS = [
  { key: "save", label: "Save the draft", done: "Saved the draft" },
  { key: "snapshot", label: "Take a snapshot", done: "Took a snapshot" },
  {
    key: "check",
    label: "Check dependencies and licenses",
    done: "Checked dependencies and licenses",
  },
  { key: "publish", label: "Publish", done: "Published" },
] as const;

type StepKey = (typeof PUBLISH_STEPS)[number]["key"];

type Phase =
  | { kind: "form" }
  | { kind: "working"; step: StepKey }
  | { kind: "report"; report: PublishReportResponse }
  | { kind: "error"; code: string | null; title: string; body?: string; retry: boolean };

/** 发布请求本身被拒绝（还没进入 worker 检查）时的说明。 */
const PUBLISH_ERRORS: Record<string, { title: string; body?: string }> = {
  "publish.label_taken": {
    title: "That version label is already used for different content",
    body: "Each label can only be used once. Pick another one.",
  },
  "check.failed": { title: "The draft has errors", body: "Fix them in the editor, then publish." },
  "request.idempotency_key_reused": {
    title: "Something changed since the last attempt",
    body: "Try again.",
  },
  "publish.import_unconfirmed": {
    title: "The imported card isn't confirmed yet",
    body: "Its rating, rights and license have to be confirmed in the import wizard before it can be published.",
  },
  "feature.disabled": {
    title: "Publishing is paused right now",
    body: "Nothing was lost. Try again later.",
  },
  "feature.read_only": {
    title: "char.pub is read-only for maintenance",
    body: "Your draft is kept. Publish again once maintenance is over.",
  },
};

/** 进度步骤：已完成的打勾，当前的转圈，之后的是空心圆。 */
export function PublishSteps({ current }: { current: StepKey | "done" }) {
  const index =
    current === "done" ? PUBLISH_STEPS.length : PUBLISH_STEPS.findIndex((s) => s.key === current);
  return (
    <ol aria-label="Publishing steps" className="space-y-1.5 text-sm">
      {PUBLISH_STEPS.map((s, i) => {
        const done = i < index;
        const active = i === index;
        const Icon = done ? CircleCheck : active ? Loader2 : Circle;
        return (
          <li
            key={s.key}
            aria-current={active ? "step" : undefined}
            className={cn("flex items-center gap-2", !done && !active && "text-text-3")}
          >
            <Icon
              aria-hidden
              className={cn(
                "size-4 shrink-0",
                done && "text-success",
                active && "animate-spin text-text-2",
              )}
            />
            {done ? s.done : active ? `${s.label}…` : s.label}
          </li>
        );
      })}
    </ol>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PublishForm({
  ids,
  displayName,
  label,
  setLabel,
  taken,
  basedOn,
  visibility,
  setVisibility,
  warnings,
  blocked,
  step,
  canPublish,
  onPublish,
}: {
  ids: { form: string; label: string; help: string; vis: string };
  displayName: string;
  label: string;
  setLabel: (label: string) => void;
  taken: boolean;
  basedOn: string | undefined;
  visibility: "public" | "private";
  setVisibility: (v: "public" | "private") => void;
  warnings: readonly CheckDiagnostic[];
  blocked: string | null;
  step: StepKey | null;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const busy = step !== null;
  const invalid = label !== "" && !LABEL_RE.test(label);
  const help = taken
    ? `${label} is already used. Pick another label.`
    : invalid || label === ""
      ? "Use letters, digits, dots, plus signs and hyphens (up to 64)."
      : `${basedOn ? `Suggested from ${basedOn}.` : "Suggested for a first release."} Any label works; it can't be reused.`;
  const first = warnings[0];
  return (
    <>
      <DialogHeader>
        <DialogTitle>Publish {displayName}</DialogTitle>
        <DialogDescription>Creates an immutable release from your current draft.</DialogDescription>
      </DialogHeader>
      <form
        id={ids.form}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canPublish) onPublish();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={ids.label} className="text-sm font-medium">
            Version label
          </label>
          <Input
            id={ids.label}
            className="font-mono"
            value={label}
            maxLength={64}
            disabled={busy}
            aria-invalid={taken || invalid || label === ""}
            aria-describedby={ids.help}
            onChange={(e) => setLabel(e.target.value.trim())}
          />
          <p
            id={ids.help}
            className={cn("text-xs", taken || invalid ? "text-danger" : "text-text-3")}
          >
            {help}
          </p>
        </div>
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-2 text-sm font-medium">Visibility</legend>
          <ChoiceCard
            name={ids.vis}
            value="public"
            checked={visibility === "public"}
            onSelect={() => setVisibility("public")}
            indicator
            title="Public"
            description="Anyone can find, preview and download it."
          />
          <ChoiceCard
            name={ids.vis}
            value="private"
            checked={visibility === "private"}
            onSelect={() => setVisibility("private")}
            indicator
            title="Private"
            description="Only you. Others get “not found”, and public creations can't depend on it."
          />
        </fieldset>
        {first ? (
          <div className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              {plural(warnings.length, "warning", "warnings")}:{" "}
              {first.detail ? sentence(first.detail) : first.code}
              {warnings.length > 1
                ? `, and ${warnings.length - 1} more in Before you publish.`
                : "."}{" "}
              Warnings don't stop publishing.
            </p>
          </div>
        ) : null}
        {blocked ? (
          <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
            {blocked}
          </p>
        ) : null}
        {step ? <PublishSteps current={step} /> : null}
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form={ids.form} disabled={!canPublish}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Rocket aria-hidden />}
          Publish {label}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PublishDialog({
  open,
  onOpenChange,
  ns,
  name,
  displayName,
  existingLabels,
  basedOn,
  flush,
  blocked,
  warnings,
  references,
  onOpenDependencies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ns: string;
  name: string;
  displayName: string;
  existingLabels: readonly string[];
  /** 建议版本号所依据的上一个版本。 */
  basedOn: string | undefined;
  /** 先把未保存的修改保存下来；返回草稿是否已经保存成功。 */
  flush: () => Promise<boolean>;
  /** 草稿当前不能发布的原因（例如有检查错误）。 */
  blocked: string | null;
  warnings: readonly CheckDiagnostic[];
  references: readonly ReferenceEdge[];
  onOpenDependencies: () => void;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [label, setLabel] = useState(() => suggestLabel(existingLabels));
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [wasOpen, setWasOpen] = useState(open);
  const idem = useRef(new IdempotencyKeys());
  const ids = { form: useId(), label: useId(), help: useId(), vis: useId() };
  const busy = phase.kind === "working";
  const taken = existingLabels.includes(label);
  const labelOk = LABEL_RE.test(label) && !taken;
  const context: IssueContext = {
    root: displayName || name,
    references,
    // 依赖行已经读过这些作品的 Release 列表，直接从缓存里把 Release ID 换成版本号。
    releaseLabel: (ref, release) => {
      const r = parseRef(ref);
      if (!r) return undefined;
      const detail = qc.getQueryData<CreationDetail>(keys.creation(r.ns, r.name));
      return detail?.releases.find((x) => x.id === release)?.label;
    },
  };

  // 重新打开时：上一次已经发布成功就从新的建议版本号开始；失败过就回到表单，保留填写的内容。
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && phase.kind === "report" && phase.report.state === "active") {
      setLabel(suggestLabel(existingLabels));
      setPhase({ kind: "form" });
    } else if (
      open &&
      (phase.kind === "error" || (phase.kind === "report" && phase.report.state === "failed"))
    ) {
      setPhase({ kind: "form" });
    }
  }

  const publish = async () => {
    try {
      setPhase({ kind: "working", step: "save" });
      if (!(await flush())) {
        setPhase({
          kind: "error",
          code: null,
          title: "The draft couldn't be saved",
          body: "Fix the errors shown in Before you publish, then try again.",
          retry: false,
        });
        return;
      }
      setPhase({ kind: "working", step: "snapshot" });
      const revision = await client.createRevision(ns, name);
      setPhase({ kind: "working", step: "check" });
      const key = idem.current.keyFor(revision.id, label, visibility);
      const first = await client.publish(
        ns,
        name,
        { revision: revision.id, label, visibility },
        key,
      );
      const report = await waitForReport(client, ns, name, label, first);
      setPhase({ kind: "report", report });
      if (report.state !== "pending") idem.current.reset();
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.creation(ns, name) }),
        qc.invalidateQueries({ queryKey: keys.myCreations }),
      ]);
    } catch (e) {
      noteApiError(e);
      const code = isApiError(e) ? e.code : null;
      const known = code ? PUBLISH_ERRORS[code] : undefined;
      if (known) idem.current.reset();
      setPhase({
        kind: "error",
        code,
        title: known?.title ?? "Publishing did not go through",
        body: known?.body ?? "Nothing was published. You can safely try again.",
        retry: !known,
      });
    }
  };

  let content: ReactNode;
  if (phase.kind === "report" && phase.report.state === "active") {
    const r = phase.report;
    content = (
      <>
        <DialogHeader>
          <DialogTitle>Published {r.label}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">
              @{ns}/{name}@{r.label}
            </span>{" "}
            {visibility === "public"
              ? "is live."
              : "is published privately. Others see “not found”."}
          </DialogDescription>
        </DialogHeader>
        {r.idempotent ? (
          <p className="text-sm text-text-2">
            This version already had exactly this content; nothing changed.
          </p>
        ) : null}
        <PublishSteps current="done" />
        <PublishReport report={r} context={context} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Back to editor</Button>
          </DialogClose>
          <Link
            to="/c/$ns/$name"
            params={{ ns, name }}
            search={{ v: r.label }}
            className={buttonVariants()}
          >
            View release <ArrowRight aria-hidden />
          </Link>
        </DialogFooter>
      </>
    );
  } else if (phase.kind === "report" && phase.report.state === "failed") {
    const r = phase.report;
    const deps = (r.report?.issues ?? []).some(
      (i) => i.severity === "error" && explainIssue(i, context).dependencies,
    );
    content = (
      <>
        <DialogHeader>
          <DialogTitle>Couldn't publish {r.label}</DialogTitle>
          <DialogDescription>
            Nothing was published. Fix the problem below and try again.
          </DialogDescription>
        </DialogHeader>
        <PublishReport report={r} context={context} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          {deps ? (
            <Button
              variant="ink"
              onClick={() => {
                onOpenChange(false);
                onOpenDependencies();
              }}
            >
              <Network aria-hidden /> Open dependencies
            </Button>
          ) : (
            <Button variant="ink" onClick={() => setPhase({ kind: "form" })}>
              Change and try again
            </Button>
          )}
        </DialogFooter>
      </>
    );
  } else if (phase.kind === "report") {
    content = (
      <>
        <DialogHeader>
          <DialogTitle>Still checking {phase.report.label}</DialogTitle>
          <DialogDescription>
            The registry is still checking dependencies, licenses and images. It finishes on its
            own; the release shows up on the creation page once it's live.
          </DialogDescription>
        </DialogHeader>
        <PublishSteps current="check" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Back to editor</Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  } else if (phase.kind === "error") {
    content = (
      <>
        <DialogHeader>
          <DialogTitle>Couldn't publish {label}</DialogTitle>
          <DialogDescription>Nothing was published.</DialogDescription>
        </DialogHeader>
        <IssueBox title={phase.title} body={phase.body} code={phase.code ?? "network"} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          {phase.retry ? (
            <Button onClick={() => void publish()}>Try again</Button>
          ) : (
            <Button variant="ink" onClick={() => setPhase({ kind: "form" })}>
              Change and try again
            </Button>
          )}
        </DialogFooter>
      </>
    );
  } else {
    content = (
      <PublishForm
        ids={ids}
        displayName={displayName || name}
        label={label}
        setLabel={setLabel}
        taken={taken}
        basedOn={basedOn}
        visibility={visibility}
        setVisibility={setVisibility}
        warnings={warnings}
        blocked={blocked}
        step={phase.kind === "working" ? phase.step : null}
        canPublish={!busy && labelOk && !blocked}
        onPublish={() => void publish()}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // 发布进行中不能关掉：结果要留在对话框里给作者看。
        if (!busy) onOpenChange(o);
      }}
    >
      <DialogContent showCloseButton={!busy} className="w-[min(34rem,calc(100vw-2rem))]">
        {content}
      </DialogContent>
    </Dialog>
  );
}
