/**
 * 发布对话框：打开时保存并构建真实草稿，审阅所需实验能力后发布固定 Revision，再等待
 * worker 检查依赖和许可 → 完成，每一步都显示进度。网络中断后重试会复用同一个
 * Idempotency-Key，不会重复发布；Publish Report 每秒轮询一次，最多 90 次。
 *
 * 结果留在对话框里：成功时显示许可检查、警告和锁定的依赖；失败时用人话解释原因并给出错误码，
 * 问题出在依赖上时可以直接跳到 Dependencies。
 */
import {
  type DraftBuildResponse,
  PublishIssueSchema,
  type ReferenceImpactResponse,
} from "@char-pub/contracts";
import {
  type Capability,
  type CheckDiagnostic,
  type CreationArtifact,
  canonicalizeCreation,
  LABEL_RE,
  type ReferenceEdge,
} from "@char-pub/core";
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
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { AuthorVisibilityChecks } from "@/components/author-visibility-checks";
import { ChoiceCard } from "@/components/choice-card";
import { allowsMature } from "@/components/creation-context";
import { MatureGate } from "@/components/mature-gate";
import {
  explainIssue,
  IssueBox,
  type IssueContext,
  IssueLocation,
  PublishReport,
} from "@/components/publish-report";
import { highestRating } from "@/components/rating";
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
import {
  type CreationDetail,
  isApiError,
  type Me,
  type PublishReportResponse,
  type ReleaseSummary,
} from "@/lib/api";
import { shareAuthorSource } from "@/lib/author-visibility";
import { CAPABILITY_NAMES } from "@/lib/capabilities";
import type { Working } from "@/lib/draft";
import { type BuildPhase, buildSavedDraft } from "@/lib/draft-build";
import type { EditorLocation } from "@/lib/editor-location";
import { editorLocation } from "@/lib/editor-location";
import { IdempotencyKeys, suggestLabel, waitForReport } from "@/lib/publish";
import { type PublishDefinitionDiff, publishDefinitionDiff } from "@/lib/publish-diff";
import { noteApiError } from "@/lib/read-only";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { parseRef } from "@/lib/text";
import type { SavedDraftSnapshot } from "@/lib/use-draft-editor";
import { cn } from "@/lib/utils";
import { PublicationDiff } from "./publish-diff";
import { ReferenceImpact } from "./reference-impact";

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

const DraftIssuesSchema = z.array(
  PublishIssueSchema.extend({
    subject: z.string().default(""),
    severity: z.enum(["error", "warning"]).default("error"),
  }),
);
function draftIssues(report: unknown): z.infer<typeof DraftIssuesSchema> {
  const parsed = z.object({ issues: DraftIssuesSchema }).safeParse(report);
  if (!parsed.success) return [];
  return parsed.data.issues.flatMap((issue) => {
    const nested = DraftIssuesSchema.safeParse(issue.data?.issues);
    return nested.success ? nested.data : [issue];
  });
}

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
  preparation,
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
  preparation: ReactNode;
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
        {preparation}
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
  releases = [],
  save,
  working,
  update,
  onLocate,
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
  releases?: readonly ReleaseSummary[];
  /** Save and capture the exact draft version reviewed before publishing. */
  save: () => Promise<SavedDraftSnapshot | null>;
  working: Working;
  update?: ((change: (working: Working) => Working) => void) | undefined;
  onLocate: (target: EditorLocation) => void;
  /** 草稿当前不能发布的原因（例如有检查错误）。 */
  blocked: string | null;
  warnings: readonly CheckDiagnostic[];
  references: readonly ReferenceEdge[];
  onOpenDependencies: () => void;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const me = useMe();
  const actor = me.data?.id;
  const [label, setLabel] = useState(() => suggestLabel(existingLabels));
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [baseline, setBaseline] = useState<ReleaseSummary | null>(
    () => releases.find((release) => release.label === basedOn) ?? null,
  );
  const baselineKey = baseline
    ? `${baseline.id}:${baseline.semantic_digest}:${baseline.label}`
    : "first-release";
  const releasesKey = JSON.stringify(
    releases.map((release) => [release.id, release.semantic_digest, release.label, release.status]),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [wasOpen, setWasOpen] = useState(open);
  const idem = useRef(new IdempotencyKeys());
  const ids = { form: useId(), label: useId(), help: useId(), vis: useId() };
  const busy = phase.kind === "working";
  type Review = {
    artifact: CreationArtifact;
    receipt: DraftBuildResponse;
    snapshot: SavedDraftSnapshot;
    key: string;
    actor: string;
    baselineKey: string;
    releasesKey: string;
    baseline: { release: ReleaseSummary; ref: string; revision: string } | null;
    diff: PublishDefinitionDiff;
    rating: CreationArtifact["meta"]["rating"];
    impact: ReferenceImpactResponse | null;
  };
  const [impactPages, setImpactPages] = useState<ReferenceImpactResponse[]>([]);
  const impactPending = useRef<string | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [preparing, setPreparing] = useState<BuildPhase | null>(null);
  const [prepareIssues, setPrepareIssues] = useState<z.infer<typeof DraftIssuesSchema>>([]);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  const publishing = useRef(false);
  const workingKey = JSON.stringify(working);
  const latest = useRef({
    workingKey,
    blocked,
    save,
    open,
    actor,
    baselineKey,
    releasesKey,
    releases,
  });
  latest.current = { workingKey, blocked, save, open, actor, baselineKey, releasesKey, releases };
  const currentActor = () => !!actor && qc.getQueryData<Me | null>(keys.me)?.id === actor;
  const ready =
    open &&
    !!review &&
    review.key === workingKey &&
    review.actor === actor &&
    review.baselineKey === baselineKey &&
    review.releasesKey === releasesKey &&
    currentActor() &&
    !!request.current &&
    !request.current.signal.aborted &&
    Date.parse(review.receipt.origin.expires_at) > Date.now();
  const experimental =
    review?.artifact.capabilities.filter((capability) => capability.experimental) ?? [];
  const prepare = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const key = latest.current.workingKey;
    const releaseListKey = latest.current.releasesKey;
    const selectedBaseline = baseline;
    const live = () =>
      request.current === controller &&
      !controller.signal.aborted &&
      latest.current.open &&
      latest.current.actor === actor &&
      qc.getQueryData<Me | null>(keys.me)?.id === actor;
    setReview(null);
    setImpactPages([]);
    setImpactError(null);
    setImpactLoading(false);
    impactPending.current = null;
    setConfirmed(false);
    setPrepareError(null);
    setPrepareIssues([]);
    setPreparing("saving");
    setPhase({ kind: "form" });
    try {
      if (!actor) throw new Error("Sign in before preparing a release.");
      if (latest.current.blocked) throw new Error(latest.current.blocked);
      const result = await buildSavedDraft({
        client,
        ns,
        name,
        save: () => latest.current.save(),
        signal: controller.signal,
        isCurrent: () =>
          live() &&
          latest.current.workingKey === key &&
          latest.current.baselineKey === baselineKey &&
          latest.current.releasesKey === releaseListKey,
        onPhase: (step) => {
          if (live()) setPreparing(step);
        },
      });
      if (!live()) return;
      if (result.receipt.state !== "ready") {
        setPrepareIssues(draftIssues(result.receipt.report));
        throw new Error("The draft could not be built. Review its checks, then try again.");
      }
      setPreparing("loading");
      const artifact = await client.draftArtifact(result.receipt, controller.signal);
      if (!live()) return;
      if (latest.current.workingKey !== key)
        throw new Error("The draft changed while preparing. Prepare it again before publishing.");
      if (Date.parse(result.receipt.origin.expires_at) <= Date.now())
        throw new Error("This build expired. Prepare it again before publishing.");
      const current = canonicalizeCreation(result.snapshot.working);
      if (current.semantic_digest !== result.receipt.semantic_digest)
        throw new Error("The saved draft does not match this build. Prepare it again.");
      let previous: ReturnType<typeof canonicalizeCreation> | null = null;
      let previousIdentity: Review["baseline"] = null;
      let rating = artifact.meta.rating;
      let impact: ReferenceImpactResponse | null = null;
      if (selectedBaseline) {
        const [source, published] = await Promise.all([
          client.releaseSource(ns, name, selectedBaseline.label),
          client.getArtifact(ns, name, selectedBaseline.label, {
            private: selectedBaseline.visibility === "private",
          }),
        ]);
        if (!live()) return;
        previous = canonicalizeCreation(source.creation);
        if (
          !("release" in published.root) ||
          published.root.release !== selectedBaseline.id ||
          published.root.semantic_digest !== selectedBaseline.semantic_digest ||
          source.semantic_digest !== selectedBaseline.semantic_digest ||
          previous.semantic_digest !== source.semantic_digest ||
          previous.creation.id !== current.creation.id ||
          previous.creation.ref !== published.root.ref
        )
          throw new Error(
            "The previous release definition changed identity. Keep this comparison and try loading it again.",
          );
        rating = highestRating(rating, published.meta.rating);
        impact = await client.draftReferenceImpact(
          result.receipt.origin.build_id,
          selectedBaseline.id,
          { signal: controller.signal },
        );
        if (!live()) return;
        if (
          impact.base.release !== selectedBaseline.id ||
          impact.base.semantic_digest !== selectedBaseline.semantic_digest ||
          impact.base.ref !== previous.creation.ref ||
          JSON.stringify(impact.candidate.origin) !== JSON.stringify(result.receipt.origin) ||
          impact.candidate.semantic_digest !== result.receipt.semantic_digest
        )
          throw new Error(
            "The reference-impact response does not match this review. Prepare it again.",
          );
        previousIdentity = {
          release: selectedBaseline,
          ref: previous.creation.ref,
          revision: source.revision,
        };
      } else if (latest.current.releases.length > 0)
        throw new Error("Choose a published version to compare before publishing.");
      if (
        latest.current.workingKey !== key ||
        latest.current.baselineKey !== baselineKey ||
        latest.current.releasesKey !== releaseListKey
      )
        throw new Error("The draft or comparison changed. Prepare it again before publishing.");
      setImpactPages(impact ? [impact] : []);
      setReview({
        artifact,
        receipt: result.receipt,
        snapshot: result.snapshot,
        key,
        actor,
        baselineKey,
        releasesKey: releaseListKey,
        baseline: previousIdentity,
        diff: publishDefinitionDiff(previous?.json ?? null, current.json),
        rating,
        impact,
      });
    } catch (error) {
      if (live() && isApiError(error)) setPrepareIssues(draftIssues(error.extra));
      if (live())
        setPrepareError(
          latest.current.workingKey !== key
            ? "The draft changed while preparing. Prepare it again before publishing."
            : error instanceof Error
              ? error.message
              : "Could not prepare this draft. Your edits are kept.",
        );
    } finally {
      if (live()) setPreparing(null);
    }
  }, [actor, client, name, ns, qc, baseline, baselineKey]);
  useEffect(() => {
    if (open && !me.isPending) void prepare();
    return () => {
      request.current?.abort();
    };
  }, [open, me.isPending, prepare]);
  useEffect(() => {
    if (!review) return;
    const ms = Date.parse(review.receipt.origin.expires_at) - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(
      () => setRefresh((value) => value + 1),
      Math.max(0, Math.min(ms, 2147483647)),
    );
    return () => clearTimeout(timer);
  }, [review, refresh]);
  useEffect(() => {
    setConfirmed(false);
  }, [workingKey, baselineKey, releasesKey]);
  const loadMoreImpact = async () => {
    const cursor = impactPages.at(-1)?.next_cursor;
    const reviewed = review;
    const controller = request.current;
    if (
      !ready ||
      !reviewed?.baseline ||
      !cursor ||
      impactLoading ||
      impactPending.current ||
      !controller
    )
      return;
    const pageKey = `${reviewed.receipt.origin.build_id}:${cursor}`;
    impactPending.current = pageKey;
    const live = () =>
      request.current === controller &&
      !controller.signal.aborted &&
      latest.current.open &&
      latest.current.actor === reviewed.actor &&
      qc.getQueryData<Me | null>(keys.me)?.id === reviewed.actor &&
      latest.current.workingKey === reviewed.key &&
      latest.current.baselineKey === reviewed.baselineKey &&
      latest.current.releasesKey === reviewed.releasesKey;
    setImpactLoading(true);
    setImpactError(null);
    try {
      const page = await client.draftReferenceImpact(
        reviewed.receipt.origin.build_id,
        reviewed.baseline.release.id,
        { cursor, signal: controller.signal },
      );
      if (!live()) return;
      if (
        page.base.release !== reviewed.baseline.release.id ||
        page.base.semantic_digest !== reviewed.baseline.release.semantic_digest ||
        page.base.ref !== reviewed.baseline.ref ||
        JSON.stringify(page.candidate.origin) !== JSON.stringify(reviewed.receipt.origin) ||
        page.candidate.semantic_digest !== reviewed.receipt.semantic_digest
      )
        throw new Error("The reference-impact page changed identity. Prepare the review again.");
      setImpactPages((previous) => [...previous, page]);
    } catch (error) {
      if (live())
        setImpactError(
          error instanceof Error ? error.message : "Could not load more references. Try again.",
        );
    } finally {
      if (impactPending.current === pageKey) impactPending.current = null;
      if (live()) setImpactLoading(false);
    }
  };
  const shareSource = (id: string) => {
    const reviewed = review;
    const controller = request.current;
    const live = () =>
      !!controller &&
      request.current === controller &&
      latest.current.open &&
      qc.getQueryData<Me | null>(keys.me)?.id === reviewed?.actor;
    if (
      !ready ||
      !reviewed ||
      reviewed.artifact.kind !== "content" ||
      !update ||
      !live() ||
      latest.current.workingKey !== reviewed.key ||
      latest.current.blocked ||
      Date.parse(reviewed.receipt.origin.expires_at) <= Date.now()
    )
      throw new Error("Prepare the current draft before sharing this document.");
    const change = shareAuthorSource(working, reviewed.artifact, id);
    let applied = false;
    update((current) => {
      if (!live() || JSON.stringify(current) !== reviewed.key)
        throw new Error("The draft changed. Prepare it again before sharing.");
      applied = true;
      controller?.abort();
      return change.working;
    });
    if (!applied) throw new Error("Resolve the draft's save state before changing its visibility.");
    return {
      undo: () => {
        let restored = false;
        update((current) => {
          if (!live())
            throw new Error("The account or work changed. Reopen the draft before undoing.");
          restored = true;
          return change.undo(current);
        });
        if (!restored) throw new Error("Resolve the draft's save state before undoing.");
      },
    };
  };
  const taken = existingLabels.includes(label);
  const labelOk = LABEL_RE.test(label) && !taken;
  const context: IssueContext = {
    root: displayName || name,
    references,
    working,
    onLocate,
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
    if (
      publishing.current ||
      !ready ||
      !review ||
      blocked ||
      !labelOk ||
      (experimental.length > 0 && !confirmed)
    )
      return;
    const reviewed = review;
    const reviewedRequest = request.current;
    const live = () =>
      request.current === reviewedRequest &&
      !reviewedRequest?.signal.aborted &&
      latest.current.open &&
      latest.current.actor === reviewed.actor &&
      qc.getQueryData<Me | null>(keys.me)?.id === reviewed.actor;
    if (
      !live() ||
      latest.current.workingKey !== reviewed.key ||
      latest.current.baselineKey !== reviewed.baselineKey ||
      latest.current.releasesKey !== reviewed.releasesKey ||
      latest.current.blocked ||
      Date.parse(reviewed.receipt.origin.expires_at) <= Date.now()
    )
      return;
    publishing.current = true;
    try {
      setPhase({ kind: "working", step: "check" });
      const revision = reviewed.receipt.origin.revision;
      const key = idem.current.keyFor(revision, label, visibility);
      const first = await client.publish(ns, name, { revision, label, visibility }, key);
      if (!live()) return;
      const report = await waitForReport(client, ns, name, label, first);
      if (!live()) return;
      setPhase({ kind: "report", report });
      if (report.state !== "pending") idem.current.reset();
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.creation(ns, name) }),
        qc.invalidateQueries({ queryKey: keys.myCreations }),
      ]);
    } catch (e) {
      if (!live()) return;
      noteApiError(e);
      const code = isApiError(e) ? e.code : null;
      const known = code ? PUBLISH_ERRORS[code] : undefined;
      if (known) idem.current.reset();
      setPhase({
        kind: "error",
        code,
        title: known?.title ?? "Publishing did not go through",
        body:
          known?.body ??
          "The result could not be confirmed. Retry this same release to check its outcome.",
        retry: !known,
      });
    } finally {
      publishing.current = false;
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
          <DialogDescription>
            {phase.retry
              ? "The publishing result could not be confirmed."
              : "The release request was not accepted."}
          </DialogDescription>
        </DialogHeader>
        <IssueBox title={phase.title} body={phase.body} code={phase.code ?? "network"} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          {phase.retry ? (
            <Button onClick={() => (ready ? void publish() : void prepare())}>Try again</Button>
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
        canPublish={
          !busy && labelOk && !blocked && ready && (experimental.length === 0 || confirmed)
        }
        preparation={
          blocked ? null : (
            <section aria-label="Release preparation" className="space-y-3 text-sm">
              {releases.length > 0 || baseline ? (
                <label className="block space-y-1">
                  Compare with published version
                  <select
                    aria-label="Compare with published version"
                    className="block w-full rounded border p-2"
                    value={baseline?.id ?? ""}
                    disabled={busy}
                    onChange={(event) => {
                      request.current?.abort();
                      setBaseline(
                        releases.find((release) => release.id === event.target.value) ?? null,
                      );
                    }}
                  >
                    {!baseline ? (
                      <option value="" disabled>
                        Choose a version
                      </option>
                    ) : null}
                    {baseline && !releases.some((release) => release.id === baseline.id) ? (
                      <option value={baseline.id}>{baseline.label} (no longer available)</option>
                    ) : null}
                    {releases.map((release) => (
                      <option
                        key={release.id}
                        value={release.id}
                        disabled={release.status === "tombstoned"}
                      >
                        {release.label}
                        {release.status === "active" ? "" : ` (${release.status})`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {preparing ? (
                <p role="status">
                  {preparing === "saving"
                    ? "Saving the draft…"
                    : preparing === "building"
                      ? "Checking the saved draft…"
                      : "Loading release requirements…"}
                </p>
              ) : ready ? (
                <>
                  <p role="status">Ready to publish the reviewed draft.</p>
                  {review ? (
                    <MatureGate
                      key={`${review.actor}:${review.receipt.origin.build_id}:${review.baselineKey}`}
                      identity={review.actor}
                      rating={review.rating}
                      allowed={allowsMature(me.data)}
                      signedIn
                    >
                      <PublicationDiff
                        diff={review.diff}
                        baseline={
                          review.baseline
                            ? `${review.baseline.ref}@${review.baseline.release.label}`
                            : null
                        }
                      />
                      <details className="text-xs text-text-2">
                        <summary>Reviewed versions</summary>
                        <p>Draft revision: {review.receipt.origin.revision}</p>
                        {review.baseline ? (
                          <>
                            <p>Previous release: {review.baseline.release.id}</p>
                            <p>Previous revision: {review.baseline.revision}</p>
                          </>
                        ) : null}
                      </details>
                      <ReferenceImpact
                        pages={impactPages}
                        loading={impactLoading}
                        error={impactError}
                        onMore={() => void loadMoreImpact()}
                      />
                    </MatureGate>
                  ) : null}
                  {experimental.length > 0 ? (
                    <div className="space-y-2 rounded-lg bg-warning-soft p-3">
                      <h3 className="font-semibold">Uses experimental capabilities</h3>
                      <p>
                        These features may change before the format is frozen. Runtimes must support
                        them to use this release.
                      </p>
                      <ul>
                        {experimental.map((capability: Capability) => (
                          <li key={capability.id}>
                            {CAPABILITY_NAMES[capability.id] ?? capability.id}
                          </li>
                        ))}
                      </ul>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          disabled={busy}
                          onChange={(event) => setConfirmed(event.target.checked)}
                        />
                        I understand this release uses experimental capabilities.
                      </label>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p role="alert">
                    {prepareError ??
                      "This draft changed, its comparison changed, or its build expired. Prepare it again before publishing."}
                  </p>
                  {prepareIssues.map((issue, index) => {
                    const explanation = explainIssue(issue, context);
                    return (
                      <IssueBox
                        key={`${issue.code}:${index}`}
                        title={explanation.title}
                        body={
                          <>
                            {explanation.body}
                            <IssueLocation subject={issue.subject} context={context} />
                          </>
                        }
                        code={issue.code}
                        subject={issue.subject}
                      />
                    );
                  })}
                  {prepareIssues.some((issue) => explainIssue(issue, context).dependencies) ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        onOpenChange(false);
                        onOpenDependencies();
                      }}
                    >
                      Open dependencies
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => void prepare()}>
                    Prepare again
                  </Button>
                </>
              )}
              {review &&
              review.actor === actor &&
              currentActor() &&
              review.artifact.kind === "content" &&
              review.artifact.assembly?.profile.mode === "per-agent" ? (
                <MatureGate
                  key={review.receipt.origin.build_id}
                  identity={review.actor}
                  rating={review.rating}
                  allowed={allowsMature(me.data)}
                  signedIn
                >
                  <AuthorVisibilityChecks
                    artifact={review.artifact}
                    disabledReason={
                      ready && !busy
                        ? undefined
                        : "Prepare the current draft before changing its visibility."
                    }
                    onLocateSource={(subject) => {
                      const target = editorLocation(working, subject);
                      if (target) onLocate(target);
                    }}
                    onShareSource={update ? shareSource : undefined}
                  />
                </MatureGate>
              ) : null}
            </section>
          )
        }
        onPublish={() => void publish()}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // 发布进行中不能关掉：结果要留在对话框里给作者看。
        if (!busy) {
          if (!o) {
            request.current?.abort();
            latest.current.open = false;
          }
          onOpenChange(o);
        }
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto"
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}
