/**
 * Tombstone（法律或严重违规下架）与四眼确认。
 *
 * 流程：输入对象 → 预览影响范围（受影响的 Release、会失效的对象与 CDN URL、下游作者）→
 * 选择原因代码并填写理由（法律原因必须关联法律请求）→ 执行。影响超过 50 个 Release 时
 * 需要第二名员工确认；只有一名有资格的员工时，发起人要等 24 小时冷静期结束后才能自己确认。
 *
 * 待确认的请求（大范围下架、CSAM 锁定账号的解封、移除 owner）集中在 Approvals 页面，
 * 下架页面也会列出。发起人或有确认资格的员工可以取消请求。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  type PendingApproval,
  TOMBSTONE_REASONS,
  type TombstonePreview,
  type TombstoneReason,
} from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { DECIDE_CAPABILITIES } from "@/lib/roles";
import { Empty, ErrorNote, Field, PageHeader, Restricted, Tag, Time, UserText } from "./page";
import { ReasonForm } from "./reason-form";

export function TombstonePage(props: { now?: () => number; initialSubject?: string } = {}) {
  return (
    <Restricted any={["tombstone.policy", "tombstone.legal"]}>
      <TombstoneForm {...props} />
    </Restricted>
  );
}

function TombstoneForm({ now, initialSubject }: { now?: () => number; initialSubject?: string }) {
  const api = useApi();
  const { can } = useMe();
  const [subject, setSubject] = useState(initialSubject ?? "@fanworks/borrowed-hero#description");
  const [preview, setPreview] = useState<TombstonePreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [code, setCode] = useState<TombstoneReason>("legal.dmca");
  const [result, setResult] = useState<string | null>(null);
  const qc = useQueryClient();
  const legalReason = code.startsWith("legal.");
  const legal = useQuery({
    queryKey: ["legal"],
    queryFn: () => api.listLegalRequests(),
    enabled: can("legal.manage"),
  });
  const allowedCodes = TOMBSTONE_REASONS.filter((r) =>
    r.startsWith("legal.") ? can("tombstone.legal") : can("tombstone.policy"),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tombstone"
        description="Removes content from distribution everywhere it appears, including every release that depends on it. Preview first."
      />
      <form
        className="flex items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setResult(null);
          try {
            setPreview(await api.previewTombstone(subject.trim()));
          } catch (err) {
            setError(err);
          }
        }}
      >
        <Field
          label="Subject (fragment, release, creation or asset digest)"
          small
          className="h-8 w-[28rem] font-mono text-xs"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <Button size="sm" variant="secondary" type="submit">
          Preview impact
        </Button>
      </form>
      {error ? <ErrorNote error={error} /> : null}
      {preview ? (
        <section className="panel space-y-3 p-4" aria-label="Impact preview">
          <div className="flex flex-wrap gap-3 text-sm">
            <span>
              <strong className="font-mono">{preview.releases.length}</strong> releases
            </span>
            <span>
              <strong className="font-mono">{preview.objects}</strong> objects
            </span>
            <span>
              <strong className="font-mono">{preview.downstream_authors.length}</strong> downstream
              authors notified
            </span>
            {preview.requires_four_eyes ? (
              <Tag tone="danger">needs a second staff member</Tag>
            ) : null}
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Affected releases</summary>
            <ul className="mt-2 max-h-48 overflow-auto font-mono text-xs">
              {preview.releases.map((r) => (
                <li key={r.id}>
                  {r.ref}@{r.label}
                  {r.via ? <span className="text-muted-foreground"> · {r.via}</span> : null}
                </li>
              ))}
            </ul>
          </details>
          {preview.downstream_authors.length > 0 ? (
            <p className="text-sm">
              Downstream authors:{" "}
              <span className="font-mono text-xs">{preview.downstream_authors.join(" ")}</span>
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            Public reason code
            <select
              className="h-8 w-72 rounded-md border bg-transparent px-2 font-mono text-xs"
              value={code}
              onChange={(e) => setCode(e.target.value as TombstoneReason)}
            >
              {allowedCodes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <ReasonForm
            submitLabel={
              preview.requires_four_eyes
                ? "Request tombstone (needs confirmation)"
                : "Execute tombstone"
            }
            danger
            confirmText="I have reviewed the impact. This removes the content from every affected release."
            {...(legalReason ? { legalRequests: legal.data ?? [] } : {})}
            onSubmit={async (input) => {
              const r = await api.requestTombstone({
                subject: preview.subject,
                reason_code: code,
                ...input,
              });
              setResult(
                r.executed
                  ? "Tombstone executed. Removal jobs are running."
                  : `Waiting for confirmation (${r.approval.id}).`,
              );
              await qc.invalidateQueries({ queryKey: ["approvals"] });
            }}
          />
          {result ? (
            <p role="status" className="text-sm">
              {result}
            </p>
          ) : null}
        </section>
      ) : null}
      <Approvals {...(now ? { now } : {})} />
    </div>
  );
}

function remaining(until: string, now: number): string {
  const ms = Math.max(0, new Date(until).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function ApprovalsPage() {
  return (
    <Restricted any={[...DECIDE_CAPABILITIES]}>
      <div className="space-y-4">
        <PageHeader
          title="Approvals"
          description="Actions with a large impact need a second staff member: large tombstones, unbanning CSAM-locked accounts and removing an owner."
        />
        <Approvals showEmpty />
      </div>
    </Restricted>
  );
}

export function Approvals({
  now: fixedNow,
  showEmpty,
}: {
  now?: () => number;
  showEmpty?: boolean;
} = {}) {
  const api = useApi();
  const { me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["approvals"], queryFn: () => api.listApprovals() });
  const [now, setNow] = useState(() => (fixedNow ?? Date.now)());
  const [deciding, setDeciding] = useState<{
    approval: PendingApproval;
    kind: "confirm" | "cancel";
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow((fixedNow ?? Date.now)()), 30_000);
    return () => clearInterval(t);
  }, [fixedNow]);
  const items = q.data ?? [];
  if (q.error) return <ErrorNote error={q.error} />;
  if (items.length === 0 && !notice) return showEmpty ? <Empty>No pending approvals.</Empty> : null;
  return (
    <section className="space-y-2" aria-label="Pending approvals">
      <h2 className="text-base">Pending four-eyes approvals</h2>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {items.map((a: PendingApproval) => {
        const mine = a.initiated_by === me?.email;
        const cooling = new Date(a.cooling_off_until).getTime() > now;
        const blocked = mine && (a.other_eligible_staff > 0 || cooling);
        return (
          <div key={a.id} className="panel space-y-2 p-3" data-testid={`approval-${a.id}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Tag tone="warn">{a.kind}</Tag>
              <span className="font-mono text-xs">{a.subject}</span>
              <span className="text-muted-foreground">
                by {a.initiated_by} at <Time iso={a.initiated_at} />
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Reason: <UserText text={a.reason} />
            </p>
            {mine && a.other_eligible_staff > 0 ? (
              <p className="text-sm">Waiting for a second staff member to confirm.</p>
            ) : null}
            {mine && a.other_eligible_staff === 0 && cooling ? (
              <p className="text-sm" data-testid="cooling-off">
                You are the only eligible staff member. Cooling-off period: you can confirm this
                yourself in{" "}
                <strong className="font-mono">{remaining(a.cooling_off_until, now)}</strong>. The
                owner has been notified.
              </p>
            ) : null}
            {mine && a.other_eligible_staff === 0 && !cooling ? (
              <p className="text-sm">
                The cooling-off period is over. Confirming your own request is recorded as such in
                the audit log.
              </p>
            ) : null}
            <div className="flex gap-2">
              {!blocked ? (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => setDeciding({ approval: a, kind: "confirm" })}
                >
                  Confirm
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                onClick={() => setDeciding({ approval: a, kind: "cancel" })}
              >
                Cancel request
              </Button>
            </div>
          </div>
        );
      })}
      {deciding ? (
        <Dialog open onOpenChange={(o) => (!o ? setDeciding(null) : undefined)}>
          <DialogContent>
            <DialogTitle>
              {deciding.kind === "confirm" ? "Confirm" : "Cancel"} {deciding.approval.kind}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono">{deciding.approval.subject}</span>
              {deciding.kind === "confirm"
                ? " — the action is executed as soon as you confirm."
                : " — the action will not be executed."}
            </DialogDescription>
            <ReasonForm
              submitLabel={deciding.kind === "confirm" ? "Confirm and execute" : "Cancel request"}
              danger={deciding.kind === "confirm"}
              onSubmit={async (input) => {
                const { approval, kind } = deciding;
                if (kind === "confirm") await api.confirmApproval(approval.id, input);
                else await api.cancelApproval(approval.id, input);
                setNotice(
                  kind === "confirm"
                    ? `Confirmed ${approval.id}; the action was executed.`
                    : `Cancelled ${approval.id}.`,
                );
                setDeciding(null);
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["approvals"] }),
                  qc.invalidateQueries({ queryKey: ["users"] }),
                  qc.invalidateQueries({ queryKey: ["staff"] }),
                ]);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
