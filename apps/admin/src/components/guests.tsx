/**
 * 经验证的访客：列表（按状态与显示名过滤）、停用与恢复。
 *
 * 访客只有自己填写的显示名，服务端不保存邮箱，这里也就没有邮箱可显示。停用会立即删除
 * 该访客的全部会话；停用后访客不能再提交 Contribution，重新验证同一个邮箱也不会解除停用。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GuestAdminView } from "@/lib/api";
import { useApi, useMe } from "@/lib/context";
import { Empty, ErrorNote, Field, PageHeader, Tag, Time, UserText } from "./page";
import { ReasonForm } from "./reason-form";

type StatusFilter = "all" | "active" | "disabled";

export function GuestsPage() {
  const api = useApi();
  const { can } = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const q = useQuery({
    queryKey: ["guests", status, applied],
    queryFn: () => api.listGuests({ status, ...(applied ? { query: applied } : {}) }),
  });
  const [acting, setActing] = useState<GuestAdminView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Guests"
        description="Visitors verified by email who can contribute where authors allow it. No email addresses are stored. Disabling signs the guest out immediately."
      />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(query.trim());
        }}
      >
        <Field
          label="Display name"
          small
          className="h-8 w-60"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-xs">
          Status
          <select
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">all</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
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
            <th scope="col">Guest</th>
            <th scope="col">Verified</th>
            <th scope="col">Sessions</th>
            <th scope="col">Contributions</th>
            <th scope="col">State</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((g) => (
            <tr key={g.id} data-testid={`guest-${g.id}`}>
              <td>
                <div>
                  <UserText text={g.display_name} />
                </div>
                <div className="font-mono text-xs text-muted-foreground">{g.id}</div>
              </td>
              <td>
                <Time iso={g.verified_at} />
              </td>
              <td className="font-mono">{g.sessions}</td>
              <td className="font-mono">{g.contributions}</td>
              <td>
                {g.disabled ? (
                  <>
                    <Tag tone="danger">disabled</Tag>{" "}
                    <span className="text-xs text-muted-foreground">
                      <Time iso={g.disabled_at} />
                    </span>
                  </>
                ) : (
                  <Tag tone="ok">active</Tag>
                )}
              </td>
              <td className="text-right">
                {can("users.ban") ? (
                  <Button
                    size="xs"
                    variant={g.disabled ? "outline" : "destructive"}
                    onClick={() => setActing(g)}
                  >
                    {g.disabled ? "Enable" : "Disable"}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.data && q.data.length === 0 ? <Empty>No guests match.</Empty> : null}
      {acting ? (
        <Dialog open onOpenChange={(o) => (!o ? setActing(null) : undefined)}>
          <DialogContent>
            <DialogTitle>
              {acting.disabled ? "Enable" : "Disable"} guest <UserText text={acting.display_name} />
            </DialogTitle>
            <DialogDescription>
              {acting.disabled
                ? "The guest can sign in and contribute again."
                : "All sessions of this guest are deleted and they can no longer contribute."}
            </DialogDescription>
            <ReasonForm
              submitLabel={acting.disabled ? "Enable guest" : "Disable guest"}
              danger={!acting.disabled}
              onSubmit={async ({ reason }) => {
                if (acting.disabled) await api.enableGuest(acting.id, { reason });
                else await api.disableGuest(acting.id, { reason });
                setNotice(`${acting.disabled ? "Enabled" : "Disabled"} guest ${acting.id}.`);
                setActing(null);
                await qc.invalidateQueries({ queryKey: ["guests"] });
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
