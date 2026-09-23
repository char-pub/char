/**
 * 法律请求与 CSAM 事件（受限页面）。
 *
 * 法律请求：登记、截止日期提醒、查看详情（解密申请人信息，每次查看都写审计）、停止访问
 * （隐藏涉及的 Creation）、登记反通知与投诉方起诉、在恢复期限内恢复内容、导出案件记录（服务端
 * 生成，导出写审计），以及跳转到下架页面预览影响并执行 tombstone（不可恢复）。
 *
 * CSAM 事件：列表、员工手动标记（与扫描命中走同一条处置路径）、登记 NCMEC 报告。登记报告后，
 * 证据保全到报告日期加 1 年。界面上永远不显示被标记的内容；具备证据权限的员工可以查看证据的
 * 元数据，并在填写理由后把证据下载为文件（一次性凭据、写审计），页面不做任何预览。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CsamIncident, LegalRequest, LegalRequestDetail, RestoreResult } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { saveFile } from "@/lib/download";
import { Empty, ErrorNote, Field, PageHeader, Restricted, Tag, Time, UserText } from "./page";
import { ReasonForm } from "./reason-form";

const HOUR = 3_600_000;
/** 截止日期在这个时间之内的未结请求会被标出。 */
export const DEADLINE_WARNING_MS = 72 * HOUR;
const LEGAL_KINDS: LegalRequest["kind"][] = ["dmca", "court", "gdpr", "other"];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** 未结请求的截止日期状态：已过期、临近（72 小时内）或正常。 */
export function deadlineState(
  l: Pick<LegalRequest, "deadline" | "status">,
  now: number,
): "overdue" | "soon" | null {
  if (!l.deadline || l.status !== "open") return null;
  const left = new Date(l.deadline).getTime() - now;
  if (left < 0) return "overdue";
  return left <= DEADLINE_WARNING_MS ? "soon" : null;
}

/**
 * 收到反通知之后的恢复状态：恢复期限已经开始（due）、已经超过最晚期限（overdue）、
 * 还没开始（waiting）；投诉方已起诉或已经恢复时为 null。
 */
export function restoreState(
  l: Pick<LegalRequest, "status" | "restore_not_before" | "restore_deadline" | "court_action_at">,
  now: number,
): "waiting" | "due" | "overdue" | null {
  if (l.status !== "counter_notice" || l.court_action_at || !l.restore_not_before) return null;
  if (now < new Date(l.restore_not_before).getTime()) return "waiting";
  if (l.restore_deadline && now > new Date(l.restore_deadline).getTime()) return "overdue";
  return "due";
}

function RestoreTag({ l }: { l: LegalRequest }) {
  const state = restoreState(l, Date.now());
  if (state === "overdue") return <Tag tone="danger">restore overdue</Tag>;
  if (state === "due") return <Tag tone="warn">restore due</Tag>;
  if (state === "waiting") return <Tag>restore window not open</Tag>;
  if (l.status === "counter_notice" && l.court_action_at) return <Tag>court action filed</Tag>;
  return null;
}

function DeadlineTag({ l }: { l: LegalRequest }) {
  const state = deadlineState(l, Date.now());
  if (state === "overdue") return <Tag tone="danger">overdue</Tag>;
  if (state === "soon") {
    const h = Math.max(0, Math.round((new Date(l.deadline ?? 0).getTime() - Date.now()) / HOUR));
    return <Tag tone="warn">due in {h}h</Tag>;
  }
  return null;
}

/** datetime-local 的值（本地时间，没有时区）转成 ISO 时间。 */
function localToIso(v: string): string {
  return new Date(v).toISOString();
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function LegalPage() {
  return (
    <Restricted any={["legal.manage"]}>
      <LegalRequests />
    </Restricted>
  );
}

function LegalRequests() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal"], queryFn: () => api.listLegalRequests() });
  const [registering, setRegistering] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Legal requests"
        description="DMCA notices, court orders and GDPR requests. Requester details are encrypted; opening a request decrypts them and writes an audit entry."
        actions={
          <Button size="sm" onClick={() => setRegistering(true)}>
            Register request
          </Button>
        }
      />
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
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
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((l) => (
            <tr key={l.id} data-testid={`legal-${l.id}`}>
              <td className="font-mono text-xs">{l.id}</td>
              <td>{l.kind}</td>
              <td className="font-mono text-xs">{l.subjects.join(", ")}</td>
              <td>
                <Time iso={l.received_at} />
              </td>
              <td>
                <div className="flex items-center gap-1.5">
                  <Time iso={l.deadline} />
                  <DeadlineTag l={l} />
                </div>
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-1.5">
                  {l.status}
                  <RestoreTag l={l} />
                </div>
              </td>
              <td className="text-right">
                <Button size="xs" variant="outline" onClick={() => setViewing(l.id)}>
                  Open
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data && q.data.length === 0 ? <Empty>No legal requests.</Empty> : null}
      {registering ? (
        <RegisterLegalDialog
          onClose={() => setRegistering(false)}
          onDone={async (id) => {
            setRegistering(false);
            setNotice(`Registered legal request ${id}.`);
            await qc.invalidateQueries({ queryKey: ["legal"] });
          }}
        />
      ) : null}
      {viewing ? (
        <LegalDetailDialog
          id={viewing}
          onClose={() => setViewing(null)}
          onChanged={async (message) => {
            setNotice(message);
            await qc.invalidateQueries({ queryKey: ["legal"] });
          }}
        />
      ) : null}
    </div>
  );
}

function RegisterLegalDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (id: string) => Promise<void>;
}) {
  const api = useApi();
  const [kind, setKind] = useState<LegalRequest["kind"]>("dmca");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [receivedAt, setReceivedAt] = useState(nowLocal);
  const [deadline, setDeadline] = useState("");
  const [subjects, setSubjects] = useState("");
  const subjectList = subjects
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const complete = name.trim() !== "" && subjectList.length > 0 && receivedAt !== "";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>Register a legal request</DialogTitle>
        <DialogDescription>
          Requester details are encrypted before they are stored and are not written to the audit
          log.
        </DialogDescription>
        <ReasonForm
          submitLabel="Register request"
          fieldsReady={complete}
          onSubmit={async ({ reason }) => {
            const r = await api.createLegalRequest({
              kind,
              requester: {
                name: name.trim(),
                ...(email.trim() ? { email: email.trim() } : {}),
                ...(organization.trim() ? { organization: organization.trim() } : {}),
              },
              received_at: localToIso(receivedAt),
              ...(deadline ? { deadline: localToIso(deadline) } : {}),
              subjects: subjectList,
              reason,
            });
            await onDone(r.id);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Kind
            <select
              className="h-8 rounded-md border bg-transparent px-2"
              value={kind}
              onChange={(e) => setKind(e.target.value as LegalRequest["kind"])}
            >
              {LEGAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Requester name"
            className="h-8"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Requester email (optional)"
              type="email"
              className="h-8"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Organization (optional)"
              className="h-8"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
            <Field
              label="Received at"
              type="datetime-local"
              className="h-8"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
            <Field
              label="Deadline (optional)"
              type="datetime-local"
              className="h-8"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="legal-subjects">
              Subjects (one per line: URL, @ns/name@label or digest)
            </Label>
            <Textarea
              id="legal-subjects"
              rows={3}
              className="font-mono text-xs"
              value={subjects}
              onChange={(e) => setSubjects(e.target.value)}
            />
          </div>
        </ReasonForm>
      </DialogContent>
    </Dialog>
  );
}

type LegalAction = "disable" | "counter" | "court" | "restore" | "export";

const LEGAL_ACTION_INFO: Record<
  LegalAction,
  { label: string; submit: string; description: string; danger?: boolean }
> = {
  disable: {
    label: "Disable access",
    submit: "Hide creations",
    description:
      "Hides the listed creations from search and their public pages. This can be restored after a valid counter-notice; a tombstone cannot.",
    danger: true,
  },
  counter: {
    label: "Register counter-notice",
    submit: "Register counter-notice",
    description:
      "The counter-notice sender's details are encrypted like the requester's. Content may be restored from the 12th to the 14th business day after it was received, unless the complainant reports a court action first.",
  },
  court: {
    label: "Record court action",
    submit: "Record court action",
    description:
      "The complainant reported that they filed a court action. The content then stays hidden and can no longer be restored under this request.",
  },
  restore: {
    label: "Restore content",
    submit: "Restore hidden creations",
    description:
      "Restores the creations hidden under this request. Creations that are also hidden for other reasons stay hidden; tombstoned objects cannot be restored.",
  },
  export: {
    label: "Export case record",
    submit: "Download case record",
    description:
      "Downloads the full case record, including decrypted requester and counter-notice details. The export is recorded in the audit log.",
  },
};

function LegalDetailDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  // 每次打开都重新请求：查看本身要留下审计记录，不使用缓存。
  const q = useQuery({
    queryKey: ["legal-detail", id],
    queryFn: () => api.getLegalRequest(id),
    gcTime: 0,
    staleTime: 0,
  });
  const l: LegalRequestDetail | undefined = q.data;
  const [action, setAction] = useState<LegalAction | null>(null);
  const [creations, setCreations] = useState("");
  const [cnName, setCnName] = useState("");
  const [cnEmail, setCnEmail] = useState("");
  const [cnAddress, setCnAddress] = useState("");
  const [cnStatement, setCnStatement] = useState("");
  const [cnReceived, setCnReceived] = useState(nowLocal);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const creationList = creations
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);

  const available: LegalAction[] = l
    ? [
        ...(l.status === "open" || l.status === "actioned" ? (["disable"] as const) : []),
        ...(l.kind === "dmca" && l.status === "actioned" ? (["counter"] as const) : []),
        ...(l.status === "counter_notice" && !l.court_action_at ? (["court"] as const) : []),
        ...(restoreState(l, Date.now()) === "due" || restoreState(l, Date.now()) === "overdue"
          ? (["restore"] as const)
          : []),
        "export" as const,
      ]
    : [];

  const fieldsReady =
    action === "disable"
      ? creationList.length > 0
      : action === "counter"
        ? cnName.trim() !== "" &&
          cnAddress.trim() !== "" &&
          cnStatement.trim() !== "" &&
          cnReceived !== ""
        : true;

  async function run(reason: string) {
    if (!action) return;
    if (action === "export") {
      saveFile(await api.exportLegalCase(id, { reason }));
      setAction(null);
      return;
    }
    let message = "";
    if (action === "disable") {
      const r = await api.disableAccess(id, { creations: creationList, reason });
      message = `Hid ${r.hidden} creation(s) under legal request ${id}.`;
      setCreations("");
    } else if (action === "counter") {
      const r = await api.registerCounterNotice(id, {
        counter_notice: {
          name: cnName.trim(),
          ...(cnEmail.trim() ? { email: cnEmail.trim() } : {}),
          address: cnAddress.trim(),
          statement: cnStatement.trim(),
        },
        received_at: localToIso(cnReceived),
        reason,
      });
      message = `Registered the counter-notice for ${id}. Restore between ${new Date(r.restore_not_before).toLocaleDateString()} and ${new Date(r.restore_deadline).toLocaleDateString()}.`;
    } else if (action === "court") {
      await api.recordCourtAction(id, { reason });
      message = `Recorded a court action for ${id}; the content stays hidden.`;
    } else {
      const r = await api.restoreLegal(id, { reason });
      setResult(r);
      message = `Restored ${r.restored.length} creation(s) for ${id}.`;
    }
    setAction(null);
    await qc.invalidateQueries({ queryKey: ["legal-detail", id] });
    await onChanged(message);
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>Legal request {id}</DialogTitle>
        <DialogDescription>
          Opening this request was recorded in the audit log. Do not copy requester details outside
          this tool.
        </DialogDescription>
        {q.error ? <ErrorNote error={q.error} /> : null}
        {l ? (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Kind</dt>
              <dd>{l.kind}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="flex items-center gap-1.5">
                {l.status}
                <RestoreTag l={l} />
              </dd>
              <dt className="text-muted-foreground">Requester</dt>
              <dd data-testid="legal-requester">
                <UserText text={l.requester.name} />
                {l.requester.organization ? (
                  <>
                    {" · "}
                    <UserText text={l.requester.organization} />
                  </>
                ) : null}
                {l.requester.email ? (
                  <div className="font-mono text-xs">
                    <UserText text={l.requester.email} />
                  </div>
                ) : null}
              </dd>
              <dt className="text-muted-foreground">Received</dt>
              <dd>
                <Time iso={l.received_at} />
              </dd>
              <dt className="text-muted-foreground">Deadline</dt>
              <dd className="flex items-center gap-1.5">
                <Time iso={l.deadline} />
                <DeadlineTag l={l} />
              </dd>
              {l.counter_notice ? (
                <>
                  <dt className="text-muted-foreground">Counter-notice</dt>
                  <dd data-testid="legal-counter-notice">
                    <UserText text={l.counter_notice.name} /> · received{" "}
                    <Time iso={l.counter_notice_received_at} />
                  </dd>
                  <dt className="text-muted-foreground">Restore window</dt>
                  <dd>
                    <Time iso={l.restore_not_before} /> – <Time iso={l.restore_deadline} />
                  </dd>
                </>
              ) : null}
            </dl>
            <div>
              <h3 className="mb-1 text-sm">Subjects</h3>
              <ul className="space-y-1">
                {l.subjects.map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs break-all">{s}</span>
                    {can("tombstone.legal") ? (
                      <Button size="xs" variant="outline" asChild>
                        <Link to="/tombstone" search={{ subject: s }}>
                          Preview tombstone
                        </Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            {l.actions.length > 0 ? (
              <div>
                <h3 className="mb-1 text-sm">Actions taken</h3>
                <ul className="space-y-1" aria-label="Actions taken">
                  {l.actions.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <Time iso={a.created_at} />
                      <span className="font-mono text-xs">{a.action}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {JSON.stringify(a.subject)}
                      </span>
                      {a.reverted ? <Tag>reverted</Tag> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result ? (
              <p role="status" className="text-sm">
                Restored {result.restored.length}; still hidden for other reasons:{" "}
                {result.kept_hidden.length}; not restorable (tombstoned): {result.not_restorable}
                {result.late ? " · restored after the deadline" : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-1">
              {available.map((a) => (
                <Button
                  key={a}
                  size="sm"
                  variant={action === a ? "default" : "outline"}
                  onClick={() => setAction(a)}
                >
                  {LEGAL_ACTION_INFO[a].label}
                </Button>
              ))}
            </div>
            {action ? (
              <section
                className="space-y-2 rounded-md border p-3"
                aria-label={LEGAL_ACTION_INFO[action].label}
              >
                <p className="text-muted-foreground">{LEGAL_ACTION_INFO[action].description}</p>
                <ReasonForm
                  key={action}
                  submitLabel={LEGAL_ACTION_INFO[action].submit}
                  danger={LEGAL_ACTION_INFO[action].danger ?? false}
                  fieldsReady={fieldsReady}
                  onSubmit={async ({ reason }) => run(reason)}
                >
                  {action === "disable" ? (
                    <div className="space-y-1">
                      <Label htmlFor="legal-creations">
                        Creations to hide (one per line: @ns/name or creation ID)
                      </Label>
                      <Textarea
                        id="legal-creations"
                        rows={3}
                        className="font-mono text-xs"
                        value={creations}
                        onChange={(e) => setCreations(e.target.value)}
                      />
                    </div>
                  ) : null}
                  {action === "counter" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field
                        label="Sender name"
                        className="h-8"
                        value={cnName}
                        onChange={(e) => setCnName(e.target.value)}
                      />
                      <Field
                        label="Sender email (optional)"
                        type="email"
                        className="h-8"
                        value={cnEmail}
                        onChange={(e) => setCnEmail(e.target.value)}
                      />
                      <Field
                        label="Sender address"
                        className="h-8"
                        value={cnAddress}
                        onChange={(e) => setCnAddress(e.target.value)}
                      />
                      <Field
                        label="Counter-notice received at"
                        type="datetime-local"
                        className="h-8"
                        value={cnReceived}
                        onChange={(e) => setCnReceived(e.target.value)}
                      />
                      <div className="col-span-2 space-y-1">
                        <Label htmlFor="legal-cn-statement">Statement</Label>
                        <Textarea
                          id="legal-cn-statement"
                          rows={3}
                          value={cnStatement}
                          onChange={(e) => setCnStatement(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </ReasonForm>
              </section>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CSAM 事件
// ---------------------------------------------------------------------------

export function CsamPage() {
  return (
    <Restricted any={["csam.read"]}>
      <CsamIncidents />
    </Restricted>
  );
}

function CsamIncidents() {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["csam"], queryFn: () => api.listCsamIncidents() });
  const [flagging, setFlagging] = useState(false);
  const [reporting, setReporting] = useState<CsamIncident | null>(null);
  const [evidence, setEvidence] = useState<CsamIncident | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [digest, setDigest] = useState("");
  const [ncmecId, setNcmecId] = useState("");
  const canFlag = can("tombstone.policy") || can("legal.manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["csam"] });
  return (
    <div className="space-y-4">
      <PageHeader
        title="CSAM incidents"
        description="Never open, forward or screenshot the content. Evidence is only accessible to the legal role: downloads need a reason, use a one-time link and are audited."
        actions={
          canFlag ? (
            <Button size="sm" variant="destructive" onClick={() => setFlagging(true)}>
              Flag content as CSAM
            </Button>
          ) : null
        }
      />
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
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
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((i) => (
            <tr key={i.id} data-testid={`incident-${i.id}`}>
              <td className="font-mono text-xs">{i.id}</td>
              <td>{i.reason}</td>
              <td className="max-w-48 truncate font-mono text-xs" title={i.blob_digest}>
                {i.blob_digest}
              </td>
              <td>
                <Time iso={i.created_at} />
              </td>
              <td className="font-mono text-xs">{i.ncmec_report_id ?? "not reported yet"}</td>
              <td>
                <Time iso={i.evidence_expires_at} />
              </td>
              <td>{i.status === "open" ? <Tag tone="danger">open</Tag> : <Tag>{i.status}</Tag>}</td>
              <td className="text-right">
                <div className="flex justify-end gap-1">
                  {can("csam.evidence") ? (
                    <Button size="xs" variant="outline" onClick={() => setEvidence(i)}>
                      Evidence
                    </Button>
                  ) : null}
                  {can("csam.report") && i.status === "open" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setNcmecId("");
                        setReporting(i);
                      }}
                    >
                      Record NCMEC report
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data && q.data.length === 0 ? <Empty>No incidents.</Empty> : null}
      {flagging ? (
        <Dialog open onOpenChange={(o) => (!o ? setFlagging(false) : undefined)}>
          <DialogContent>
            <DialogTitle>Flag content as CSAM</DialogTitle>
            <DialogDescription>
              The content is quarantined, evidence is preserved, the uploader is locked, the digest
              is blocked and every release that uses it is taken down. Do not open the content.
            </DialogDescription>
            <ReasonForm
              submitLabel="Flag and quarantine"
              danger
              fieldsReady={DIGEST_RE.test(digest)}
              confirmText="I understand this locks the uploader and takes down every release that uses this content."
              onSubmit={async ({ reason }) => {
                const r = await api.flagCsam({ blob_digest: digest, reason });
                setFlagging(false);
                setDigest("");
                setNotice(
                  `Opened incident ${r.incident_id}; ${r.affected_releases} release(s) queued for takedown.`,
                );
                await refresh();
              }}
            >
              <Field
                label="Content digest"
                className="h-8 font-mono text-xs"
                placeholder="sha256:…"
                value={digest}
                onChange={(e) => setDigest(e.target.value.trim())}
              />
            </ReasonForm>
          </DialogContent>
        </Dialog>
      ) : null}
      {evidence ? <EvidenceDialog incident={evidence} onClose={() => setEvidence(null)} /> : null}
      {reporting ? (
        <Dialog open onOpenChange={(o) => (!o ? setReporting(null) : undefined)}>
          <DialogContent>
            <DialogTitle>Record NCMEC report for {reporting.id}</DialogTitle>
            <DialogDescription>
              Evidence is then kept until one year after today and deleted automatically.
            </DialogDescription>
            <ReasonForm
              submitLabel="Record report"
              fieldsReady={ncmecId.trim() !== ""}
              onSubmit={async ({ reason }) => {
                await api.reportCsamIncident(reporting.id, {
                  ncmec_report_id: ncmecId.trim(),
                  reason,
                });
                setNotice(`Recorded NCMEC report ${ncmecId.trim()} for ${reporting.id}.`);
                setReporting(null);
                await refresh();
              }}
            >
              <Field
                label="NCMEC report ID"
                className="h-8 font-mono text-xs"
                value={ncmecId}
                onChange={(e) => setNcmecId(e.target.value)}
              />
            </ReasonForm>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * 隔离证据：只显示元数据；下载前必须填写理由并勾选确认，下载得到的是一个文件，
 * 页面上不显示任何内容预览。
 */
function EvidenceDialog({ incident, onClose }: { incident: CsamIncident; onClose: () => void }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ["evidence", incident.id],
    queryFn: () => api.getEvidence(incident.id),
    gcTime: 0,
    staleTime: 0,
  });
  const [done, setDone] = useState(false);
  const m = q.data;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>Evidence for {incident.id}</DialogTitle>
        <DialogDescription>
          Metadata only. The content is never shown here. Download it only when it is required for a
          report to the authorities.
        </DialogDescription>
        {q.error ? <ErrorNote error={q.error} /> : null}
        {m ? (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1" data-testid="evidence-meta">
              <dt className="text-muted-foreground">Digest</dt>
              <dd className="font-mono text-xs break-all">{m.evidence_digest}</dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd className="font-mono">{m.size === null ? "—" : `${m.size} bytes`}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-mono text-xs">{m.media_type ?? "—"}</dd>
              <dt className="text-muted-foreground">Stored at</dt>
              <dd className="font-mono text-xs break-all">
                {m.storage.bucket}/{m.storage.key}
              </dd>
              <dt className="text-muted-foreground">Kept until</dt>
              <dd>{m.retain_until ? <Time iso={m.retain_until} /> : "until reported"}</dd>
            </dl>
            {done ? (
              <p role="status">The evidence file was downloaded. The link cannot be used again.</p>
            ) : null}
            <ReasonForm
              submitLabel="Download evidence file"
              danger
              fieldsReady={m.present}
              confirmText="I need this file for a report to the authorities and will not open it on this device beyond what the report requires."
              onSubmit={async ({ reason }) => {
                saveFile(await api.downloadEvidence(incident.id, { reason }));
                setDone(true);
              }}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
