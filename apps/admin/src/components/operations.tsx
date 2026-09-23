/**
 * 用户处置、Namespace 治理、法律请求、CSAM 事件、任务面板与仪表盘。
 * 这些页面依赖的后端接口还没有实现，界面按前端契约开发并标注。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { UserAdminView, WithReason } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { FLAG_INFO } from "./flags";
import { Empty, ErrorNote, Field, PageHeader, PendingBackend, Tag, Time, UserText } from "./page";
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
    }
    await qc.invalidateQueries({ queryKey: ["users"] });
    setActing(null);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Banning immediately revokes every session and token of the account."
      />
      <PendingBackend
        endpoints={[
          "GET /v1/admin/users",
          "POST /v1/admin/users/:id/ban",
          "POST /v1/admin/users/:id/unban",
        ]}
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
            <tr key={u.id}>
              <td>
                <div>
                  <UserText text={u.name} />
                </div>
                <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td className="font-mono text-xs">{u.namespaces.map((n) => `@${n}`).join(" ")}</td>
              <td className="font-mono text-xs">
                {u.sessions} / {u.tokens}
              </td>
              <td>
                {u.banned ? (
                  <Tag tone="danger">banned{u.csam_locked ? " · csam lock" : ""}</Tag>
                ) : (
                  <Tag tone="ok">active</Tag>
                )}
              </td>
              <td>
                <Time iso={u.created_at} />
              </td>
              <td className="text-right">
                {can("users.ban") ? (
                  <Button
                    size="xs"
                    variant={u.banned ? "outline" : "destructive"}
                    onClick={() => setActing({ user: u, kind: u.banned ? "unban" : "ban" })}
                  >
                    {u.banned ? "Unban" : "Ban"}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

export function NamespacesPage() {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  const ns = useQuery({ queryKey: ["namespaces"], queryFn: () => api.listNamespaces({}) });
  const reserved = useQuery({ queryKey: ["reserved"], queryFn: () => api.listReserved() });
  const [slug, setSlug] = useState("");
  const [freezing, setFreezing] = useState<{ slug: string; status: "active" | "suspended" } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: (input: WithReason) => api.addReserved({ slug, ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reserved"] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Namespaces"
        description="Reserved names, freezing and rename arbitration. Old names stay reserved forever after a rename."
      />
      <PendingBackend
        endpoints={[
          "GET /v1/admin/namespaces",
          "GET/POST /v1/admin/reserved-names",
          "POST /v1/admin/namespaces/:slug/status",
        ]}
      />
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
            <tr key={n.slug}>
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
                {can("namespaces.govern") && n.kind !== "system" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      setFreezing({
                        slug: n.slug,
                        status: n.status === "active" ? "suspended" : "active",
                      })
                    }
                  >
                    {n.status === "active" ? "Freeze" : "Unfreeze"}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base">Reserved names</h2>
          {can("namespaces.govern") ? (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              Reserve a name
            </Button>
          ) : null}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {(reserved.data ?? []).map((r) => (
            <li key={r.slug}>
              <Tag>
                @{r.slug} · {r.reason}
              </Tag>
            </li>
          ))}
        </ul>
      </section>
      {freezing ? (
        <Dialog open onOpenChange={(o) => (!o ? setFreezing(null) : undefined)}>
          <DialogContent>
            <DialogTitle>
              {freezing.status === "suspended" ? "Freeze" : "Unfreeze"} @{freezing.slug}
            </DialogTitle>
            <DialogDescription>
              A frozen namespace cannot publish or edit; its content stays readable.
            </DialogDescription>
            <ReasonForm
              submitLabel="Confirm"
              danger={freezing.status === "suspended"}
              onSubmit={async (input) => {
                await api.setNamespaceStatus(freezing.slug, { status: freezing.status, ...input });
                await qc.invalidateQueries({ queryKey: ["namespaces"] });
                setFreezing(null);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {adding ? (
        <Dialog open onOpenChange={(o) => (!o ? setAdding(false) : undefined)}>
          <DialogContent>
            <DialogTitle>Reserve a namespace</DialogTitle>
            <DialogDescription>Reserved names cannot be registered by anyone.</DialogDescription>
            <ReasonForm
              submitLabel="Reserve"
              onSubmit={async (input) => {
                await add.mutateAsync(input);
                setAdding(false);
              }}
            >
              <Field
                label="Name"
                className="h-8 font-mono"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </ReasonForm>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 法律请求与 CSAM 事件（受限页面）
// ---------------------------------------------------------------------------

export function LegalPage() {
  const api = useApi();
  const { can } = useMe();
  const q = useQuery({
    queryKey: ["legal"],
    queryFn: () => api.listLegalRequests(),
    enabled: can("legal.manage"),
  });
  if (!can("legal.manage")) return <ErrorNote error={new Error("legal or owner role required")} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Legal requests"
        description="DMCA notices, court orders and GDPR requests. Requester details are encrypted and only visible here."
      />
      <PendingBackend endpoints={["GET/POST /v1/admin/legal-requests"]} />
      {q.error ? <ErrorNote error={q.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Kind</th>
            <th scope="col">Subjects</th>
            <th scope="col">Received</th>
            <th scope="col">Deadline</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((l) => (
            <tr key={l.id}>
              <td className="font-mono text-xs">{l.id}</td>
              <td>{l.kind}</td>
              <td className="font-mono text-xs">{l.subjects.join(", ")}</td>
              <td>
                <Time iso={l.received_at} />
              </td>
              <td>
                <Time iso={l.deadline} />
              </td>
              <td>{l.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CsamPage() {
  const api = useApi();
  const { can } = useMe();
  const q = useQuery({
    queryKey: ["csam"],
    queryFn: () => api.listCsamIncidents(),
    enabled: can("csam.read"),
  });
  if (!can("csam.read"))
    return <ErrorNote error={new Error("trust & safety, legal or owner role required")} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="CSAM incidents"
        description="Never download, forward or screenshot the content. Evidence is only accessible to the legal role and every access is audited."
      />
      <PendingBackend
        endpoints={["GET /v1/admin/csam-incidents", "POST /v1/admin/csam-incidents/:id/report"]}
      />
      {q.error ? <ErrorNote error={q.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Incident</th>
            <th scope="col">Source</th>
            <th scope="col">Digest</th>
            <th scope="col">Opened</th>
            <th scope="col">NCMEC report</th>
            <th scope="col">Evidence kept until</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((i) => (
            <tr key={i.id}>
              <td className="font-mono text-xs">{i.id}</td>
              <td>{i.reason}</td>
              <td className="font-mono text-xs">{i.blob_digest}</td>
              <td>
                <Time iso={i.created_at} />
              </td>
              <td className="font-mono text-xs">
                {i.ncmec_report_id ?? (can("csam.report") ? "not reported yet" : "—")}
              </td>
              <td>
                <Time iso={i.evidence_expires_at} />
              </td>
              <td>{i.status === "open" ? <Tag tone="danger">open</Tag> : <Tag>{i.status}</Tag>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

export function JobsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const queues = useQuery({ queryKey: ["queues"], queryFn: () => api.listQueues() });
  const failed = useQuery({ queryKey: ["failed-jobs"], queryFn: () => api.listFailedJobs() });
  const [acting, setActing] = useState<{ id: string; kind: "retry" | "cancel" } | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        description="Background queues (pg-boss). Retrying or cancelling a job is audited."
      />
      <PendingBackend
        endpoints={[
          "GET /v1/admin/queues",
          "GET /v1/admin/jobs/failed",
          "POST /v1/admin/jobs/:id/retry",
          "POST /v1/admin/jobs/:id/cancel",
        ]}
      />
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
            <tr key={q.name}>
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
            <tr key={j.id}>
              <td className="font-mono text-xs">{j.id}</td>
              <td className="font-mono text-xs">{j.queue}</td>
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
              Jobs are idempotent, so retrying never duplicates their effect.
            </DialogDescription>
            <ReasonForm
              submitLabel={acting.kind === "retry" ? "Retry job" : "Cancel job"}
              danger={acting.kind === "cancel"}
              onSubmit={async (input) => {
                if (acting.kind === "retry") await api.retryJob(acting.id, input);
                else await api.cancelJob(acting.id, input);
                await qc.invalidateQueries({ queryKey: ["failed-jobs"] });
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
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => api.listReports() });
  const flags = useQuery({ queryKey: ["flags"], queryFn: () => api.listFlags() });
  const queues = useQuery({ queryKey: ["queues"], queryFn: () => api.listQueues() });
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
  const open = (reports.data ?? []).filter(
    (r) => r.status === "open" || r.status === "claimed",
  ).length;
  const off = (flags.data ?? []).filter((f) => !f.enabled);
  const failed = (queues.data ?? []).reduce((n, q) => n + q.failed + q.dead, 0);
  const tiles: {
    label: string;
    value: string | number;
    to: string;
    alert?: boolean;
    show: boolean;
  }[] = [
    { label: "Open reports", value: open, to: "/reports", show: true },
    {
      label: "Open legal requests",
      value: (legal.data ?? []).filter((l) => l.status === "open").length,
      to: "/legal",
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles
          .filter((t) => t.show)
          .map((t) => (
            <Link key={t.label} to={t.to} className="panel block p-3 hover:bg-muted/50">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className={`font-mono text-2xl ${t.alert ? "text-danger" : ""}`}>{t.value}</div>
            </Link>
          ))}
      </div>
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
    </div>
  );
}
