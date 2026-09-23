/**
 * 举报队列与内容处置（隐藏 / 恢复、强制评级、代作者 yank）。
 * 举报描述和作品简介都是用户写的，只按纯文本显示。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { CreationAdminView, Report, ReportAction, WithReason } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { Empty, ErrorNote, Field, PageHeader, Tag, Time, UserText } from "./page";
import { ReasonForm } from "./reason-form";

const SEVERITY_TONE = {
  low: "neutral",
  medium: "warn",
  high: "danger",
  critical: "danger",
} as const;
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const RATINGS = ["general", "teen", "mature", "explicit"] as const;

const ACTION_LABEL: Record<ReportAction, string> = {
  dismiss: "Dismiss",
  hide: "Hide content",
  force_rating: "Force rating",
  yank: "Yank release",
  escalate: "Escalate to T&S / legal",
};

export function ReportsPage() {
  const api = useApi();
  const { can } = useMe();
  const q = useQuery({ queryKey: ["reports"], queryFn: () => api.listReports() });
  const [acting, setActing] = useState<{ report: Report; action: ReportAction } | null>(null);
  const sorted = [...(q.data ?? [])].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.created_at.localeCompare(b.created_at),
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Report queue" description="Sorted by severity, then age." />
      {q.error ? <ErrorNote error={q.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Category</th>
            <th scope="col">Subject</th>
            <th scope="col">Details</th>
            <th scope="col">Status</th>
            <th scope="col">Received</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} data-testid={`report-${r.id}`}>
              <td>
                <Tag tone={SEVERITY_TONE[r.severity]}>{r.severity}</Tag>
              </td>
              <td className="font-mono text-xs">{r.category}</td>
              <td className="font-mono text-xs">
                {r.subject.type}:{r.subject.label}
              </td>
              <td className="max-w-80">
                <UserText text={r.details} />
              </td>
              <td>
                {r.status}
                {r.assignee ? (
                  <div className="text-xs text-muted-foreground">{r.assignee}</div>
                ) : null}
              </td>
              <td>
                <Time iso={r.created_at} />
              </td>
              <td>
                {can("reports.handle") && (r.status === "open" || r.status === "claimed") ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {(["dismiss", "hide", "force_rating", "escalate"] as ReportAction[]).map(
                      (a) => (
                        <Button
                          key={a}
                          size="xs"
                          variant="outline"
                          onClick={() => setActing({ report: r, action: a })}
                        >
                          {ACTION_LABEL[a]}
                        </Button>
                      ),
                    )}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data && q.data.length === 0 ? <Empty>The queue is empty.</Empty> : null}
      {acting ? <ReportActionDialog {...acting} onClose={() => setActing(null)} /> : null}
    </div>
  );
}

function ReportActionDialog({
  report,
  action,
  onClose,
}: {
  report: Report;
  action: ReportAction;
  onClose: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [rating, setRating] = useState<string>("mature");
  const m = useMutation({
    mutationFn: (input: WithReason) =>
      api.actOnReport(report.id, {
        action,
        ...input,
        ...(action === "force_rating" ? { rating } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>{ACTION_LABEL[action]}</DialogTitle>
        <DialogDescription>
          Report {report.id} about <span className="font-mono">{report.subject.label}</span>.
        </DialogDescription>
        <ReasonForm
          submitLabel={ACTION_LABEL[action]}
          danger={action !== "dismiss" && action !== "escalate"}
          onSubmit={async (input) => {
            await m.mutateAsync(input);
            onClose();
          }}
        >
          {action === "force_rating" ? <RatingSelect value={rating} onChange={setRating} /> : null}
        </ReasonForm>
      </DialogContent>
    </Dialog>
  );
}

function RatingSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Rating (can only be raised; the creation itself is not modified)
      <select
        className="h-8 rounded-md border bg-transparent px-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {RATINGS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  );
}

type ContentAction = { kind: "hide" | "unhide" | "rating" } | { kind: "yank"; releaseId: string };

export function ContentPage() {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  const [ref, setRef] = useState("@fanworks/borrowed-hero");
  const [query, setQuery] = useState(ref);
  const q = useQuery({
    queryKey: ["creation", query],
    queryFn: () => api.getCreation(query),
    enabled: query !== "",
  });
  const [acting, setActing] = useState<ContentAction | null>(null);
  const [rating, setRating] = useState("mature");
  const c: CreationAdminView | undefined = q.data;

  async function run(input: WithReason) {
    if (!c || !acting) return;
    if (acting.kind === "yank") {
      await api.yankRelease(acting.releaseId, input);
    } else if (acting.kind === "rating") {
      await api.forceRating(c.id, { rating, ...input });
    } else {
      await api.hideCreation(c.id, { hidden: acting.kind === "hide", ...input });
    }
    await qc.invalidateQueries({ queryKey: ["creation", query] });
    setActing(null);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Content"
        description="Look up any creation or release. Viewing private content is itself recorded in the audit log."
      />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(ref.trim());
        }}
      >
        <Field
          label="Creation"
          small
          className="h-8 w-80 font-mono text-xs"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <Button size="sm" variant="secondary" type="submit">
          Look up
        </Button>
      </form>
      {q.error ? <ErrorNote error={q.error} /> : null}
      {c ? (
        <section className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base">
              <UserText text={c.display_name} />
            </h2>
            <span className="font-mono text-xs text-muted-foreground">{c.ref}</span>
            <Tag tone={c.status === "active" ? "ok" : "warn"}>{c.status}</Tag>
            <Tag>rating {c.rating}</Tag>
            {c.forced_rating ? <Tag tone="warn">forced {c.forced_rating}</Tag> : null}
          </div>
          <p className="text-sm">
            <UserText text={c.summary} />
          </p>
          <div className="flex flex-wrap gap-2">
            {can("creations.hide") ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setActing({ kind: c.status === "hidden" ? "unhide" : "hide" })}
              >
                {c.status === "hidden" ? "Restore" : "Hide"}
              </Button>
            ) : null}
            {can("reports.handle") ? (
              <Button size="xs" variant="outline" onClick={() => setActing({ kind: "rating" })}>
                Force rating
              </Button>
            ) : null}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Release</th>
                <th scope="col">Visibility</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {c.releases.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.label}</td>
                  <td>{r.visibility}</td>
                  <td>{r.status}</td>
                  <td className="text-right">
                    {can("releases.yank") && r.status === "active" ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => setActing({ kind: "yank", releaseId: r.id })}
                      >
                        Yank
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {acting && c ? (
        <Dialog open onOpenChange={(o) => (!o ? setActing(null) : undefined)}>
          <DialogContent>
            <DialogTitle>
              {acting.kind === "yank"
                ? "Yank release"
                : acting.kind === "rating"
                  ? "Force rating"
                  : acting.kind === "hide"
                    ? "Hide creation"
                    : "Restore creation"}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono">{c.ref}</span>. Staff never edit the creation itself.
            </DialogDescription>
            <ReasonForm submitLabel="Confirm" danger={acting.kind !== "unhide"} onSubmit={run}>
              {acting.kind === "rating" ? (
                <RatingSelect value={rating} onChange={setRating} />
              ) : null}
            </ReasonForm>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
