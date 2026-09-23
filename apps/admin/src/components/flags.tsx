/**
 * 运行开关（kill switch）。每个开关关闭一类功能；切换必须填写理由，并在对话框里二次确认。
 * 各进程最多 5 秒刷新一次开关状态，所以切换后 5 秒内全部生效。
 * `read_only` 与 `publish` 影响面最大，用醒目的样式标出。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Flag, FlagKey } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { ErrorNote, PageHeader, Tag, Time } from "./page";
import { ReasonForm } from "./reason-form";

export const FLAG_INFO: Record<FlagKey, { label: string; effect: string }> = {
  signups: { label: "Sign-ups", effect: "New users and new namespaces cannot be created." },
  uploads: { label: "Uploads", effect: "No upload URLs are issued and imports are refused." },
  publish: {
    label: "Publishing",
    effect: "All publishing (web and GitHub Action) returns 503; queued publish jobs pause.",
  },
  contributions: { label: "Contributions", effect: "New contributions cannot be submitted." },
  github_sync: { label: "GitHub sync", effect: "Webhooks are still received but not processed." },
  guest_access: {
    label: "Guest access",
    effect: "Guest verification and guest contributions stop.",
  },
  read_only: { label: "Read-only mode", effect: "Every write endpoint returns 503 (maintenance)." },
};

export const DANGEROUS_FLAGS: ReadonlySet<FlagKey> = new Set(["read_only", "publish"]);

export function FlagsPage() {
  const api = useApi();
  const { can } = useMe();
  const q = useQuery({ queryKey: ["flags"], queryFn: () => api.listFlags() });
  const [editing, setEditing] = useState<Flag | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kill switches"
        description="Switching a flag off disables that feature everywhere within 5 seconds. Every change needs a reason and is audited."
      />
      {q.error ? <ErrorNote error={q.error} /> : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">State</th>
            <th scope="col">When off</th>
            <th scope="col">Last reason</th>
            <th scope="col">Updated</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((f) => {
            const dangerous = DANGEROUS_FLAGS.has(f.key);
            return (
              <tr
                key={f.key}
                data-testid={`flag-${f.key}`}
                className={dangerous ? "bg-danger-soft/25" : undefined}
              >
                <td>
                  <div className="flex items-center gap-1.5 font-medium">
                    {dangerous ? (
                      <AlertOctagon aria-label="High impact" className="size-3.5 text-danger" />
                    ) : null}
                    {FLAG_INFO[f.key].label}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{f.key}</div>
                </td>
                <td>{f.enabled ? <Tag tone="ok">on</Tag> : <Tag tone="danger">off</Tag>}</td>
                <td className="text-muted-foreground">{FLAG_INFO[f.key].effect}</td>
                <td className="max-w-64 break-words">{f.reason ?? "—"}</td>
                <td>
                  <Time iso={f.updated_at} />
                </td>
                <td className="text-right">
                  {can("flags.toggle") ? (
                    <Button
                      size="xs"
                      variant={f.enabled ? (dangerous ? "destructive" : "outline") : "default"}
                      onClick={() => setEditing(f)}
                    >
                      {f.enabled ? "Switch off" : "Switch on"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing ? <ToggleDialog flag={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ToggleDialog({ flag, onClose }: { flag: Flag; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const next = !flag.enabled;
  const info = FLAG_INFO[flag.key];
  const m = useMutation({
    mutationFn: (reason: string) => api.setFlag(flag.key, { enabled: next, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flags"] }),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>
          {next ? "Switch on" : "Switch off"} {info.label}
        </DialogTitle>
        <DialogDescription>
          {next ? "The feature becomes available again." : info.effect} Takes effect in all
          processes within 5 seconds.
        </DialogDescription>
        <ReasonForm
          submitLabel={`${next ? "Switch on" : "Switch off"} ${info.label.toLowerCase()}`}
          danger={!next}
          confirmText={`I understand this ${next ? "re-enables" : "disables"} ${info.label.toLowerCase()} for everyone.`}
          onSubmit={async ({ reason }) => {
            await m.mutateAsync(reason);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
