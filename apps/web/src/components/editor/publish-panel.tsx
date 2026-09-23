/**
 * 发布面板：选择版本号与可见性，然后依次保存草稿、生成 Revision、发布并等待 Publish
 * Report。网络中断后重试会复用同一个 Idempotency-Key，不会重复发布。
 */
import { LABEL_RE } from "@char-pub/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useId, useRef, useState } from "react";
import { PublishReport } from "@/components/publish-report";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError, type PublishReportResponse } from "@/lib/api";
import { IdempotencyKeys, suggestLabel, waitForReport } from "@/lib/publish";
import { keys, useRegistry } from "@/lib/registry";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "report"; report: PublishReportResponse }
  | { kind: "error"; message: string; retry: boolean };

const PUBLISH_ERRORS: Record<string, string> = {
  "publish.label_taken": "That version number is already used for different content.",
  "check.failed": "The draft has errors. Fix them before publishing.",
  "request.idempotency_key_reused": "Something changed since the last attempt. Try again.",
  "feature.disabled": "Publishing is paused right now. Try again later.",
};

export function PublishPanel({
  ns,
  name,
  existingLabels,
  flush,
  blocked,
}: {
  ns: string;
  name: string;
  existingLabels: readonly string[];
  /** 先把未保存的修改保存下来；返回草稿是否已经保存成功。 */
  flush: () => Promise<boolean>;
  /** 草稿当前不能发布的原因（例如有检查错误）。 */
  blocked: string | null;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [label, setLabel] = useState(() => suggestLabel(existingLabels));
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const idem = useRef(new IdempotencyKeys());
  const ids = { label: useId(), vis: useId() };
  const labelOk = LABEL_RE.test(label);
  const busy = phase.kind === "working";

  const publish = async () => {
    try {
      setPhase({ kind: "working", step: "Saving the draft…" });
      if (!(await flush())) {
        setPhase({ kind: "error", message: "Save the draft first — it has errors.", retry: false });
        return;
      }
      setPhase({ kind: "working", step: "Taking a snapshot…" });
      const revision = await client.createRevision(ns, name);
      setPhase({ kind: "working", step: "Publishing…" });
      const key = idem.current.keyFor(revision.id, label, visibility);
      const first = await client.publish(
        ns,
        name,
        { revision: revision.id, label, visibility },
        key,
      );
      setPhase({ kind: "report", report: { ...first, label } });
      const report = await waitForReport(client, ns, name, label, first);
      setPhase({ kind: "report", report });
      if (report.state !== "pending") idem.current.reset();
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.creation(ns, name) }),
        qc.invalidateQueries({ queryKey: keys.myCreations }),
      ]);
    } catch (e) {
      const known = isApiError(e) ? PUBLISH_ERRORS[e.code] : undefined;
      if (known) idem.current.reset();
      setPhase({
        kind: "error",
        message: known ?? "Publishing did not go through. You can safely try again.",
        retry: !known,
      });
    }
  };

  return (
    <section aria-labelledby="publish-h" className="space-y-4">
      <h2 id="publish-h" className="text-2xl">
        Publish
      </h2>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={ids.label} className="text-sm">
            Version
          </label>
          <Input
            id={ids.label}
            className="font-mono"
            value={label}
            maxLength={64}
            aria-invalid={!labelOk}
            onChange={(e) => setLabel(e.target.value.trim())}
          />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm">Visibility</legend>
          <div className="flex gap-4 text-sm">
            {(["public", "private"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={ids.vis}
                  className="accent-[var(--seal)]"
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                />
                {v === "public" ? "Public — anyone can find and use it" : "Private — only you"}
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          type="button"
          disabled={busy || !labelOk || !!blocked}
          onClick={() => void publish()}
        >
          <Send aria-hidden /> {phase.kind === "error" && phase.retry ? "Retry" : "Publish"}
        </Button>
      </div>
      {blocked ? <p className="text-sm text-seal">{blocked}</p> : null}
      {phase.kind === "working" ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {phase.step}
        </p>
      ) : null}
      {phase.kind === "error" ? (
        <p role="alert" className="text-sm text-seal">
          {phase.message}
        </p>
      ) : null}
      {phase.kind === "report" ? (
        <div className="space-y-3">
          <PublishReport report={phase.report} />
          {phase.report.state === "active" && visibility === "public" ? (
            <Link
              to="/c/$ns/$name"
              params={{ ns, name }}
              search={{ v: phase.report.label }}
              className={buttonVariants()}
            >
              Open the creation page
            </Link>
          ) : phase.report.state === "active" ? (
            <Link
              to="/c/$ns/$name"
              params={{ ns, name }}
              search={{ v: phase.report.label }}
              className={buttonVariants({ variant: "outline" })}
            >
              Open the private release
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
