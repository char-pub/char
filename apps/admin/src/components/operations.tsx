/**
 * 用户处置、Namespace 治理、任务面板与仪表盘。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { NamespaceAdminView, UserAdminView, WithReason } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { DECIDE_CAPABILITIES } from "@/lib/roles";
import { FLAG_INFO } from "./flags";
import { deadlineState } from "./legal";
import { Empty, ErrorNote, Field, PageHeader, Restricted, Tag, Time, UserText } from "./page";
import { ReasonForm } from "./reason-form";

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------

export function UsersPage() {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const q = useQuery({
    queryKey: ["users", applied],
    queryFn: () => api.listUsers({ query: applied }),
  });
  const [acting, setActing] = useState<{ user: UserAdminView; kind: "ban" | "unban" } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [until, setUntil] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function run(input: WithReason) {
    if (!acting) return;
    if (acting.kind === "ban") {
      await api.banUser(acting.user.id, {
        ...input,
        ...(until ? { until: new Date(until).toISOString() } : {}),
      });
      setNotice(`Banned ${acting.user.email}; all sessions and tokens were revoked.`);
    } else {
      const r = await api.unbanUser(acting.user.id, input);
      setNotice(
        r.approval
          ? `This account was locked for CSAM. Unbanning needs a second staff member (${r.approval.id}).`
          : `Unbanned ${acting.user.email}.`,
      );
      if (r.approval) await qc.invalidateQueries({ queryKey: ["approvals"] });
    }
    await qc.invalidateQueries({ queryKey: ["users"] });
    await qc.invalidateQueries({ queryKey: ["user"] });
    setActing(null);
    setUntil("");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Banning immediately revokes every session and token of the account. Accounts locked because of a CSAM incident can only be unbanned with a second staff member."
      />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(query.trim());
        }}
      >
        <Field
          label="Email or name"
          small
          className="h-8 w-72"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button size="sm" variant="secondary" type="submit">
          Search
        </Button>
      </form>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Namespaces</th>
            <th scope="col">Sessions / tokens</th>
            <th scope="col">State</th>
            <th scope="col">Created</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((u) => (
            <tr key={u.id} data-testid={`user-${u.id}`}>
              <td>
                <div>
                  <UserText text={u.name} />
                </div>
                <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td className="font-mono text-xs">{u.namespaces.join(" ")}</td>
              <td className="font-mono text-xs">
                {u.sessions} / {u.tokens}
              </td>
              <td>
                {u.banned ? (
                  <Tag tone="danger">banned{u.csam_locked ? " · csam lock" : ""}</Tag>
                ) : (
                  <Tag tone="ok">active</Tag>
                )}
                {u.ban_expires ? (
                  <div className="text-xs text-muted-foreground">
                    until <Time iso={u.ban_expires} />
                  </div>
                ) : null}
              </td>
              <td>
                <Time iso={u.created_at} />
              </td>
              <td className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="outline" onClick={() => setViewing(u.id)}>
                    Details
                  </Button>
                  {can("users.ban") ? (
                    <Button
                      size="xs"
                      variant={u.banned ? "outline" : "destructive"}
                      onClick={() => setActing({ user: u, kind: u.banned ? "unban" : "ban" })}
                    >
                      {u.banned ? "Unban" : "Ban"}
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewing ? <UserDetailDialog id={viewing} onClose={() => setViewing(null)} /> : null}
      {acting ? (
        <Dialog open onOpenChange={(o) => (!o ? setActing(null) : undefined)}>
          <DialogContent>
            <DialogTitle>
              {acting.kind === "ban" ? "Ban" : "Unban"} {acting.user.email}
            </DialogTitle>
            <DialogDescription>
              {acting.kind === "ban"
                ? "All sessions and personal tokens are revoked immediately."
                : acting.user.csam_locked
                  ? "This account was locked because of a CSAM incident. A second staff member must confirm."
                  : "The user can sign in again."}
            </DialogDescription>
            <ReasonForm
              submitLabel={acting.kind === "ban" ? "Ban account" : "Unban account"}
              danger={acting.kind === "ban"}
              onSubmit={run}
            >
              {acting.kind === "ban" ? (
                <Field
                  label="Until (optional; empty means indefinitely)"
                  type="datetime-local"
                  className="h-8 w-60"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              ) : null}
            </ReasonForm>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function UserDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ["user", id], queryFn: () => api.getUser(id) });
  const u = q.data;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>{u ? u.email : "Account"}</DialogTitle>
        <DialogDescription>Account overview and moderation history.</DialogDescription>
        {q.error ? <ErrorNote error={q.error} /> : null}
        {u ? (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Name</dt>
              <dd>
                <UserText text={u.name} />
              </dd>
              <dt className="text-muted-foreground">ID</dt>
              <dd className="font-mono text-xs">{u.id}</dd>
              <dt className="text-muted-foreground">Namespaces</dt>
              <dd className="font-mono text-xs">{u.namespaces.join(" ") || "—"}</dd>
              <dt className="text-muted-foreground">Creations</dt>
              <dd className="font-mono">{u.creations}</dd>
              <dt className="text-muted-foreground">Sessions / tokens</dt>
              <dd className="font-mono">
                {u.sessions} / {u.tokens}
              </dd>
              <dt className="text-muted-foreground">State</dt>
              <dd>
                {u.banned ? (
                  <>
                    <Tag tone="danger">banned</Tag>{" "}
                    {u.ban_reason ? <UserText text={u.ban_reason} /> : null}
                  </>
                ) : (
                  <Tag tone="ok">active</Tag>
                )}
              </dd>
            </dl>
            <div>
              <h3 className="mb-1 text-sm">Moderation history</h3>
              {u.recent_actions.length === 0 ? (
                <p className="text-muted-foreground">No actions recorded.</p>
              ) : (
                <ul className="space-y-1" aria-label="Moderation history">
                  {u.recent_actions.map((a) => (
                    <li key={a.id} className="flex flex-wrap gap-2">
                      <Time iso={a.created_at} />
                      <span className="font-mono text-xs">{a.action}</span>
                      <span className="text-muted-foreground">
                        <UserText text={a.reason} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

type NamespaceAction =
  | { kind: "status"; ns: NamespaceAdminView; status: "active" | "suspended" }
  | { kind: "rename"; ns: NamespaceAdminView }
  | { kind: "reserve" }
  | { kind: "unreserve"; slug: string };

export function NamespacesPage() {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  const ns = useQuery({ queryKey: ["namespaces"], queryFn: () => api.listNamespaces({}) });
  const reserved = useQuery({ queryKey: ["reserved"], queryFn: () => api.listReserved() });
  const [acting, setActing] = useState<NamespaceAction | null>(null);
  const [slug, setSlug] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const govern = can("namespaces.govern");
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["namespaces"] }),
      qc.invalidateQueries({ queryKey: ["reserved"] }),
    ]);
  const run = useMutation({
    mutationFn: async (input: WithReason) => {
      if (!acting) return;
      if (acting.kind === "status") {
        await api.setNamespaceStatus(acting.ns.slug, { status: acting.status, ...input });
        setNotice(`${acting.status === "suspended" ? "Froze" : "Unfroze"} @${acting.ns.slug}.`);
      } else if (acting.kind === "rename") {
        await api.renameNamespace(acting.ns.slug, { new_slug: slug, ...input });
        setNotice(`Renamed @${acting.ns.slug} to @${slug}; the old name now redirects.`);
      } else if (acting.kind === "reserve") {
        await api.addReserved({ slug, ...input });
        setNotice(`Reserved @${slug}.`);
      } else {
        await api.removeReserved(acting.slug, input);
        setNotice(`Released the reservation of @${acting.slug}.`);
      }
    },
    onSuccess: async () => {
      setActing(null);
      setSlug("");
      await refresh();
    },
  });

  const title =
    acting?.kind === "status"
      ? `${acting.status === "suspended" ? "Freeze" : "Unfreeze"} @${acting.ns.slug}`
      : acting?.kind === "rename"
        ? `Rename @${acting.ns.slug}`
        : acting?.kind === "reserve"
          ? "Reserve a namespace"
          : acting?.kind === "unreserve"
            ? `Release reservation of @${acting.slug}`
            : "";
  const description =
    acting?.kind === "status"
      ? "A frozen namespace cannot publish or edit, and its content is hidden from the public."
      : acting?.kind === "rename"
        ? "The old name is kept as a permanent redirect and can never be registered by anyone else."
        : acting?.kind === "reserve"
          ? "Reserved names cannot be registered by anyone."
          : "Releasing a reservation does not free a name that is already registered or redirected.";
  const needsSlug = acting?.kind === "rename" || acting?.kind === "reserve";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Namespaces"
        description="Reserved names, freezing and rename arbitration. Old names stay reserved forever after a rename."
      />
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {ns.error ? <ErrorNote error={ns.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Namespace</th>
            <th scope="col">Kind</th>
            <th scope="col">Owner</th>
            <th scope="col">Redirects from</th>
            <th scope="col">State</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(ns.data ?? []).map((n) => (
            <tr key={n.slug} data-testid={`namespace-${n.slug}`}>
              <td className="font-mono text-xs">@{n.slug}</td>
              <td>{n.kind}</td>
              <td className="font-mono text-xs">{n.owner ?? "—"}</td>
              <td className="font-mono text-xs">
                {n.redirects.map((r) => `@${r}`).join(" ") || "—"}
              </td>
              <td>
                {n.status === "active" ? (
                  <Tag tone="ok">active</Tag>
                ) : (
                  <Tag tone="danger">suspended</Tag>
                )}
              </td>
              <td className="text-right">
                {govern && n.kind !== "system" ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        setActing({
                          kind: "status",
                          ns: n,
                          status: n.status === "active" ? "suspended" : "active",
                        })
                      }
                    >
                      {n.status === "active" ? "Freeze" : "Unfreeze"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setSlug("");
                        setActing({ kind: "rename", ns: n });
                      }}
                    >
                      Rename
                    </Button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base">Reserved names</h2>
          {govern ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setSlug("");
                setActing({ kind: "reserve" });
              }}
            >
              Reserve a name
            </Button>
          ) : null}
        </div>
        {reserved.error ? <ErrorNote error={reserved.error} /> : null}
        <ul className="flex flex-wrap gap-1.5" aria-label="Reserved names">
          {(reserved.data ?? []).map((r) => (
            <li key={r.slug} className="flex items-center gap-1">
              <Tag>
                @{r.slug} · {r.reason}
              </Tag>
              {govern ? (
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Release @${r.slug}`}
                  onClick={() => setActing({ kind: "unreserve", slug: r.slug })}
                >
                  ×
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {acting ? (
        <Dialog open onOpenChange={(o) => (!o ? setActing(null) : undefined)}>
          <DialogContent>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
            <ReasonForm
              submitLabel="Confirm"
              danger={acting.kind === "status" && acting.status === "suspended"}
              fieldsReady={!needsSlug || slug !== ""}
              onSubmit={async (input) => {
                await run.mutateAsync(input);
              }}
            >
              {needsSlug ? (
                <Field
                  label={acting.kind === "rename" ? "New name" : "Name"}
                  className="h-8 font-mono"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                />
              ) : null}
            </ReasonForm>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

export function JobsPage() {
  return (
    <Restricted any={["jobs.manage"]}>
      <Jobs />
    </Restricted>
  );
}

function Jobs() {
  const api = useApi();
  const qc = useQueryClient();
  const queues = useQuery({ queryKey: ["queues"], queryFn: () => api.listQueues() });
  const failed = useQuery({ queryKey: ["failed-jobs"], queryFn: () => api.listFailedJobs() });
  const [acting, setActing] = useState<{ id: string; kind: "retry" | "cancel" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        description="Background queues (pg-boss). Retrying or cancelling a job is audited."
      />
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {queues.error ? <ErrorNote error={queues.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Queue</th>
            <th scope="col">Queued</th>
            <th scope="col">Active</th>
            <th scope="col">Failed</th>
            <th scope="col">Dead letter</th>
          </tr>
        </thead>
        <tbody>
          {(queues.data ?? []).map((q) => (
            <tr key={q.name} data-testid={`queue-${q.name}`}>
              <td className="font-mono text-xs">{q.name}</td>
              <td className="font-mono">{q.queued}</td>
              <td className="font-mono">{q.active}</td>
              <td className={q.failed ? "font-mono text-danger" : "font-mono"}>{q.failed}</td>
              <td className={q.dead ? "font-mono text-danger" : "font-mono"}>{q.dead}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="text-base">Failed jobs</h2>
      {failed.error ? <ErrorNote error={failed.error} /> : null}
      {failed.data && failed.data.length === 0 ? <Empty>No failed jobs.</Empty> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Queue</th>
            <th scope="col">Error</th>
            <th scope="col">Attempts</th>
            <th scope="col">Failed at</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(failed.data ?? []).map((j) => (
            <tr key={j.id} data-testid={`job-${j.id}`}>
              <td className="font-mono text-xs">{j.id}</td>
              <td className="font-mono text-xs">
                {j.queue}
                {j.queue.endsWith(".dead") ? (
                  <>
                    {" "}
                    <Tag tone="danger">dead letter</Tag>
                  </>
                ) : null}
              </td>
              <td className="font-mono text-xs">
                <UserText text={j.error} />
              </td>
              <td className="font-mono">{j.attempts}</td>
              <td>
                <Time iso={j.failed_at} />
              </td>
              <td className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setActing({ id: j.id, kind: "retry" })}
                  >
                    Retry
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setActing({ id: j.id, kind: "cancel" })}
                  >
                    Cancel
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {acting ? (
        <Dialog open onOpenChange={(o) => (!o ? setActing(null) : undefined)}>
          <DialogContent>
            <DialogTitle>
              {acting.kind === "retry" ? "Retry" : "Cancel"} job {acting.id}
            </DialogTitle>
            <DialogDescription>
              {acting.kind === "retry"
                ? "Jobs are idempotent, so retrying never duplicates their effect. Dead-letter jobs are sent back to their queue."
                : "The job is dropped and will not run again."}
            </DialogDescription>
            <ReasonForm
              submitLabel={acting.kind === "retry" ? "Retry job" : "Cancel job"}
              danger={acting.kind === "cancel"}
              onSubmit={async (input) => {
                if (acting.kind === "retry") await api.retryJob(acting.id, input);
                else await api.cancelJob(acting.id, input);
                setNotice(
                  `${acting.kind === "retry" ? "Re-queued" : "Cancelled"} job ${acting.id}.`,
                );
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["failed-jobs"] }),
                  qc.invalidateQueries({ queryKey: ["queues"] }),
                ]);
                setActing(null);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 仪表盘
// ---------------------------------------------------------------------------

export function DashboardPage() {
  const api = useApi();
  const { can } = useMe();
  const decide = DECIDE_CAPABILITIES.some(can);
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.listReports(),
    enabled: can("overview.read"),
  });
  const flags = useQuery({
    queryKey: ["flags"],
    queryFn: () => api.listFlags(),
    enabled: can("overview.read"),
  });
  const queues = useQuery({
    queryKey: ["queues"],
    queryFn: () => api.listQueues(),
    enabled: can("jobs.manage"),
  });
  const legal = useQuery({
    queryKey: ["legal"],
    queryFn: () => api.listLegalRequests(),
    enabled: can("legal.manage"),
  });
  const csam = useQuery({
    queryKey: ["csam"],
    queryFn: () => api.listCsamIncidents(),
    enabled: can("csam.read"),
  });
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api.listApprovals(),
    enabled: decide,
  });
  const open = (reports.data ?? []).filter(
    (r) => r.status === "open" || r.status === "claimed",
  ).length;
  const off = (flags.data ?? []).filter((f) => !f.enabled);
  const failed = (queues.data ?? []).reduce((n, q) => n + q.failed + q.dead, 0);
  const backlog = (queues.data ?? []).reduce((n, q) => n + q.queued, 0);
  const openLegal = (legal.data ?? []).filter((l) => l.status === "open");
  const now = Date.now();
  const urgentLegal = openLegal.filter((l) => deadlineState(l, now) !== null);
  const nextDeadline = openLegal
    .map((l) => l.deadline)
    .filter((d): d is string => d !== null)
    .sort()[0];
  const tiles: {
    label: string;
    value: string | number;
    to: string;
    alert?: boolean;
    note?: string;
    show: boolean;
  }[] = [
    { label: "Open reports", value: open, to: "/reports", show: can("overview.read") },
    {
      label: "Open legal requests",
      value: openLegal.length,
      to: "/legal",
      alert: urgentLegal.length > 0,
      ...(nextDeadline
        ? { note: `next deadline ${nextDeadline.slice(0, 16).replace("T", " ")}` }
        : {}),
      show: can("legal.manage"),
    },
    {
      label: "Open CSAM incidents",
      value: (csam.data ?? []).filter((i) => i.status === "open").length,
      to: "/csam",
      alert: (csam.data ?? []).some((i) => i.status === "open"),
      show: can("csam.read"),
    },
    {
      label: "Pending approvals",
      value: (approvals.data ?? []).length,
      to: "/approvals",
      show: decide,
    },
    { label: "Queue backlog", value: backlog, to: "/jobs", show: can("jobs.manage") },
    {
      label: "Failed / dead jobs",
      value: failed,
      to: "/jobs",
      alert: failed > 0,
      show: can("jobs.manage"),
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles
          .filter((t) => t.show)
          .map((t) => (
            <Link
              key={t.label}
              to={t.to}
              className="panel block p-3 hover:bg-muted/50"
              data-testid={`tile-${t.label}`}
            >
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className={`font-mono text-2xl ${t.alert ? "text-danger" : ""}`}>{t.value}</div>
              {t.note ? <div className="text-xs text-muted-foreground">{t.note}</div> : null}
            </Link>
          ))}
      </div>
      {can("overview.read") ? (
        <section className="panel p-3">
          <h2 className="mb-2 text-sm">Kill switches</h2>
          {off.length === 0 ? (
            <p className="text-sm text-muted-foreground">All features are on.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {off.map((f) => (
                <li key={f.key} className="flex items-center gap-2">
                  <Tag tone="danger">off</Tag> {FLAG_INFO[f.key].label}
                  {f.reason ? <span className="text-muted-foreground">— {f.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
