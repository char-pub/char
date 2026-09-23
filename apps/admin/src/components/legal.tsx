/**
 * 法律请求与 CSAM 事件（受限页面）。
 *
 * 法律请求：登记、截止日期提醒、查看详情（解密申请人信息，每次查看都写审计）、导出案件记录，
 * 以及跳转到下架页面预览影响并执行。
 *
 * CSAM 事件：列表、员工手动标记（与扫描命中走同一条处置路径）、登记 NCMEC 报告。登记报告后，
 * 证据保全到报告日期加 1 年。界面上永远不显示或下载被标记的内容本身。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CsamIncident, LegalRequest, LegalRequestDetail } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { downloadJson } from "@/lib/utils";
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
              <td>{l.status}</td>
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
      {viewing ? <LegalDetailDialog id={viewing} onClose={() => setViewing(null)} /> : null}
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

function LegalDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApi();
  const { can } = useMe();
  // 每次打开都重新请求：查看本身要留下审计记录，不使用缓存。
  const q = useQuery({
    queryKey: ["legal-detail", id],
    queryFn: () => api.getLegalRequest(id),
    gcTime: 0,
    staleTime: 0,
  });
  const l: LegalRequestDetail | undefined = q.data;
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
              <dd>{l.status}</dd>
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
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const audit = await api.listAudit({ subject: `legal_request:${id}`, limit: 200 });
                  downloadJson(`legal-request-${id}.json`, {
                    exported_at: new Date().toISOString(),
                    request: l,
                    audit: audit.items,
                  });
                }}
              >
                Export case record
              </Button>
            </div>
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
  const [notice, setNotice] = useState<string | null>(null);
  const [digest, setDigest] = useState("");
  const [ncmecId, setNcmecId] = useState("");
  const canFlag = can("tombstone.policy") || can("legal.manage");
  const refresh = () => qc.invalidateQueries({ queryKey: ["csam"] });
  return (
    <div className="space-y-4">
      <PageHeader
        title="CSAM incidents"
        description="Never download, forward or screenshot the content. Evidence is only accessible to the legal role and every access is audited."
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
