/**
 * 审计日志：分页浏览、按 subject 过滤、展开查看字段变更、校验哈希链、导出。
 * 只有 `audit.read_own` 能力的员工只能看到自己的操作，这由后端过滤。
 * 导出由服务端按当前过滤条件生成 NDJSON（每次最多 10000 条，更多时可以接着导出下一批），
 * 必须填写理由，导出本身写入审计。
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ShieldCheck, ShieldX } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AuditVerify } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { saveFile } from "@/lib/download";
import { cn } from "@/lib/utils";
import { JsonDiff } from "./json-diff";
import { Empty, ErrorNote, Field, PageHeader, Restricted, Time } from "./page";
import { ReasonForm } from "./reason-form";

const PAGE = 50;

export function AuditPage() {
  return (
    <Restricted any={["audit.read_own", "audit.read_all"]}>
      <AuditLog />
    </Restricted>
  );
}

function AuditLog() {
  const api = useApi();
  const { can } = useMe();
  const [subject, setSubject] = useState("");
  const [applied, setApplied] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const q = useQuery({
    queryKey: ["audit", applied, before],
    queryFn: () =>
      api.listAudit({
        limit: PAGE,
        ...(applied ? { subject: applied } : {}),
        ...(before ? { before } : {}),
      }),
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const [verifyError, setVerifyError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  /** 上一次导出还有剩余时，下一批的起点。 */
  const [exportNext, setExportNext] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Append-only, hash-chained record of every staff and system action."
        actions={
          can("audit.read_all") ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setExporting(true)}>
                Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setVerifyError(null);
                  try {
                    setVerify(await api.verifyAudit());
                  } catch (e) {
                    setVerifyError(e);
                  }
                }}
              >
                Verify hash chain
              </Button>
            </>
          ) : null
        }
      />
      {exportNotice ? (
        <p role="status" className="text-sm">
          {exportNotice}
        </p>
      ) : null}
      {exporting ? (
        <Dialog open onOpenChange={(o) => (!o ? setExporting(false) : undefined)}>
          <DialogContent>
            <DialogTitle>Export the audit log</DialogTitle>
            <DialogDescription>
              Exports {applied ? `entries for ${applied}` : "all entries"} as NDJSON, newest first,
              up to 10,000 per file{exportNext ? `, continuing below entry ${exportNext}` : ""}. The
              export itself is recorded in the audit log.
            </DialogDescription>
            <ReasonForm
              submitLabel="Download NDJSON"
              onSubmit={async ({ reason }) => {
                const file = await api.exportAudit({
                  reason,
                  ...(applied ? { subject: applied } : {}),
                  ...(exportNext ? { before: exportNext } : {}),
                });
                saveFile(file);
                setExportNext(file.next_before);
                setExportNotice(
                  file.next_before
                    ? `Downloaded ${file.filename}. More entries remain; export again to continue.`
                    : `Downloaded ${file.filename}.`,
                );
                setExporting(false);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {verify ? (
        <p
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            verify.ok ? "border-ok/50 bg-ok-soft/50" : "border-danger/60 bg-danger-soft/60",
          )}
        >
          {verify.ok ? (
            <>
              <ShieldCheck aria-hidden className="size-4 text-ok" /> Chain intact · {verify.count}{" "}
              entries · head <code className="font-mono text-xs">{verify.head ?? "—"}</code>
            </>
          ) : (
            <>
              <ShieldX aria-hidden className="size-4 text-danger" /> Chain broken at entry{" "}
              <code className="font-mono">{verify.brokenAt}</code> ({verify.reason})
            </>
          )}
        </p>
      ) : null}
      {verifyError ? <ErrorNote error={verifyError} /> : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCursors([]);
          setApplied(subject.trim());
        }}
      >
        <Field
          label="Subject"
          small
          className="h-8 w-80 font-mono text-xs"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. flag:uploads or release:rel_…"
        />
        <Button size="sm" type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {q.error ? <ErrorNote error={q.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="w-6">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col">#</th>
            <th scope="col">At</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Subject</th>
            <th scope="col">Hash</th>
          </tr>
        </thead>
        <tbody>
          {(q.data?.items ?? []).map((a) => {
            const expanded = open.has(a.id);
            return (
              <Fragment key={a.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`Show changes of entry ${a.id}`}
                      className="rounded-sm p-0.5 hover:bg-muted"
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s);
                          if (n.has(a.id)) n.delete(a.id);
                          else n.add(a.id);
                          return n;
                        })
                      }
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
                      />
                    </button>
                  </td>
                  <td className="font-mono text-xs">{a.id}</td>
                  <td>
                    <Time iso={a.at} />
                  </td>
                  <td className="font-mono text-xs">
                    {a.actor.kind}:{a.actor.id}
                  </td>
                  <td className="font-mono text-xs">{a.action}</td>
                  <td className="font-mono text-xs break-all">{a.subject}</td>
                  <td className="font-mono text-xs text-muted-foreground">{a.hash.slice(0, 16)}</td>
                </tr>
                {expanded ? (
                  <tr>
                    <td />
                    <td colSpan={6} className="bg-muted/40">
                      <JsonDiff before={a.before} after={a.after} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {q.data && q.data.items.length === 0 ? <Empty>No audit entries match.</Empty> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Newer
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!q.data?.next_before}
          onClick={() => {
            const next = q.data?.next_before;
            if (next) setCursors((c) => [...c, next]);
          }}
        >
          Older
        </Button>
      </div>
    </div>
  );
}
