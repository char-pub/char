/**
 * 员工与角色管理，只有 owner 可以使用。
 *
 * 角色可以叠加。移除某人的 owner 角色需要第二名 owner 确认（提交后生成待确认请求）；
 * 系统里必须始终至少保留一名 owner，所以唯一 owner 的 owner 角色在这里不能取消。
 * 员工角色只在 admin 中生效，公开站点上员工没有任何管理权限。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STAFF_ROLES, type StaffMember, type StaffRole } from "@/lib/api";
import { useApi } from "@/lib/context";
import { ErrorNote, PageHeader, Restricted, Tag } from "./page";
import { ReasonForm } from "./reason-form";

const ROLE_HINT: Record<StaffRole, string> = {
  viewer: "read-only overview; sees only their own audit entries",
  moderator: "handles ordinary reports: dismiss, hide, force rating, yank",
  trust_safety: "bans, policy tombstones, kill switches, read-only CSAM incidents",
  legal: "legal requests, legal tombstones, NCMEC reports, full audit log",
  admin: "operations: namespaces, jobs, kill switches, bans",
  owner: "everything, including staff management",
};

export function StaffPage() {
  return (
    <Restricted any={["staff.manage"]}>
      <StaffList />
    </Restricted>
  );
}

function StaffList() {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["staff"], queryFn: () => api.listStaff() });
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const owners = (q.data ?? []).filter((s) => s.roles.includes("owner"));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff"
        description="Staff roles only apply in admin. Removing an owner needs a second owner, and at least one owner must remain."
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
            <th scope="col">Staff member</th>
            <th scope="col">Roles</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((s) => (
            <tr key={s.id} data-testid={`staff-${s.email}`}>
              <td>
                <div>{s.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{s.email}</div>
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {s.roles.length === 0 ? <Tag>no roles</Tag> : null}
                  {s.roles.map((r) => (
                    <Tag key={r} tone={r === "owner" ? "warn" : "neutral"}>
                      {r}
                    </Tag>
                  ))}
                </div>
              </td>
              <td className="text-right">
                <Button size="xs" variant="outline" onClick={() => setEditing(s)}>
                  Edit roles
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <EditRolesDialog
          member={editing}
          onlyOwner={owners.length === 1 && editing.roles.includes("owner")}
          onClose={() => setEditing(null)}
          onDone={async (message) => {
            setEditing(null);
            setNotice(message);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["staff"] }),
              qc.invalidateQueries({ queryKey: ["approvals"] }),
            ]);
          }}
        />
      ) : null}
    </div>
  );
}

function EditRolesDialog({
  member,
  onlyOwner,
  onClose,
  onDone,
}: {
  member: StaffMember;
  onlyOwner: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const api = useApi();
  const [roles, setRoles] = useState<Set<StaffRole>>(new Set(member.roles));
  const changed = roles.size !== member.roles.length || member.roles.some((r) => !roles.has(r));
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>Roles of {member.email}</DialogTitle>
        <DialogDescription>Roles add up; owner includes every capability.</DialogDescription>
        <ReasonForm
          submitLabel="Save roles"
          fieldsReady={changed}
          onSubmit={async ({ reason }) => {
            const next = STAFF_ROLES.filter((r) => roles.has(r));
            const r = await api.setStaffRoles(member.id, { roles: next, reason });
            await onDone(
              r.approval
                ? `Removing the owner role needs a second owner to confirm (${r.approval.id}).`
                : `Updated roles of ${member.email}.`,
            );
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm">Roles</legend>
            {STAFF_ROLES.map((r) => {
              const locked = r === "owner" && onlyOwner;
              return (
                <label key={r} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={roles.has(r)}
                    disabled={locked}
                    onChange={(e) =>
                      setRoles((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(r);
                        else n.delete(r);
                        return n;
                      })
                    }
                  />
                  <span>
                    <span className="font-mono">{r}</span>{" "}
                    <span className="text-muted-foreground">— {ROLE_HINT[r]}</span>
                    {locked ? (
                      <span className="block text-xs text-signal-ink">
                        This is the only owner. At least one owner must remain.
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </ReasonForm>
      </DialogContent>
    </Dialog>
  );
}
