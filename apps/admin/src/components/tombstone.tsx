/**
 * Tombstone（法律或严重违规下架）与四眼确认。
 *
 * 流程：输入对象 → 预览影响范围（受影响的 Release、会失效的对象与 CDN URL、下游作者）→
 * 选择原因代码并填写理由（法律原因必须关联法律请求）→ 执行。影响超过 50 个 Release 时
 * 需要第二名员工确认；只有一名有资格的员工时，发起人要等 24 小时冷静期结束后才能自己确认。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type PendingApproval,
  TOMBSTONE_REASONS,
  type TombstonePreview,
  type TombstoneReason,
} from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { ErrorNote, Field, PageHeader, Tag, Time } from "./page";
import { ReasonForm } from "./reason-form";

export function TombstonePage({ now }: { now?: () => number } = {}) {
  const api = useApi();
  const { can } = useMe();
  const [subject, setSubject] = useState("@fanworks/borrowed-hero#description");
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
                </li>
              ))}
            </ul>
          </details>
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

export function Approvals({ now: fixedNow }: { now?: () => number } = {}) {
  const api = useApi();
  const { me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["approvals"], queryFn: () => api.listApprovals() });
  const [now, setNow] = useState(() => (fixedNow ?? Date.now)());
  useEffect(() => {
    const t = setInterval(() => setNow((fixedNow ?? Date.now)()), 30_000);
    return () => clearInterval(t);
  }, [fixedNow]);
  const confirm = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.confirmApproval(id, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Pending approvals">
      <h2 className="text-base">Pending four-eyes approvals</h2>
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
            {!blocked ? (
              <ReasonForm
                submitLabel="Confirm"
                danger
                onSubmit={async ({ reason }) => {
                  await confirm.mutateAsync({ id: a.id, reason });
                }}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
