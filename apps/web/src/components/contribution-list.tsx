/**
 * 作品的 Contribution 列表：可以按状态和是否由 Agent 提交过滤；Agent 提交的条目有醒目的
 * 标记。作品的成员看到全部，其他登录用户和访客只看到自己提交的。
 *
 * 成员还可以在这里设置谁可以提交（所有人 / 登录用户 / 受邀用户 / 关闭）并管理邀请名单。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ContributionPolicy,
  type ContributionStatus,
  type ContributionSummary,
  isApiError,
} from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";
import { UserText } from "./user-content";

const selectClass =
  "h-9 rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

export const STATUS_LABEL: Record<ContributionStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const STATUS_CLASS: Record<ContributionStatus, string> = {
  open: "border-seal text-seal",
  accepted: "border-moss text-moss",
  rejected: "border-rule text-muted-foreground",
  withdrawn: "border-rule text-muted-foreground",
};

export const POLICY_LABEL: Record<ContributionPolicy, string> = {
  anyone: "Anyone, including verified guests",
  "signed-in": "Signed-in users",
  invited: "Invited users only",
  closed: "Nobody (closed)",
};

export function StatusStamp({ status }: { status: ContributionStatus }) {
  return <span className={`stamp ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** Agent 提交的 Contribution 的标记。 */
export function AgentStamp() {
  return (
    <span
      className="stamp border-amber bg-amber-soft text-foreground"
      title="Submitted by an agent"
    >
      <Bot aria-hidden className="size-3" /> agent
    </span>
  );
}

/**
 * 提交者的显示文字。当前用户（登录用户或访客）显示“you”；访客显示自己填写的名字；
 * 登录用户显示显示名与 namespace，都没有时才退回用户 ID。
 */
export function authorLabel(
  author: ContributionSummary["author"],
  me?: { user?: string | undefined; guest?: string | undefined },
) {
  if ("guest_id" in author) {
    return author.guest_id === me?.guest ? "you" : `${author.display_name} (guest)`;
  }
  if (author.user === me?.user) return "you";
  if (author.display_name && author.namespace)
    return `${author.display_name} (${author.namespace})`;
  return author.display_name ?? author.namespace ?? `user ${author.user}`;
}

type AgentFilter = "all" | "agent" | "human";

export function ContributionList({
  ns,
  name,
  meId,
  guestId,
}: {
  ns: string;
  name: string;
  meId?: string | undefined;
  /** 以访客身份查看时的访客 ID：只会列出这个访客自己提交的。 */
  guestId?: string | undefined;
}) {
  const client = useRegistry();
  const ids = { status: useId(), agent: useId() };
  const [status, setStatus] = useState<ContributionStatus | "">("open");
  const [agent, setAgent] = useState<AgentFilter>("all");
  const q = {
    status: status || undefined,
    agent: agent === "all" ? undefined : agent === "agent",
  };
  const list = useQuery({
    queryKey: keys.contributions(ns, name, q),
    queryFn: () => client.contributions(ns, name, q),
  });

  return (
    <section aria-labelledby="contrib-list" className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <h2 id="contrib-list" className="mr-auto text-2xl">
          Contributions
        </h2>
        <div className="space-y-1">
          <label htmlFor={ids.status} className="block text-xs text-muted-foreground">
            Status
          </label>
          <select
            id={ids.status}
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as ContributionStatus | "")}
          >
            <option value="">All</option>
            {(Object.keys(STATUS_LABEL) as ContributionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.agent} className="block text-xs text-muted-foreground">
            Submitted by
          </label>
          <select
            id={ids.agent}
            className={selectClass}
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentFilter)}
          >
            <option value="all">People and agents</option>
            <option value="human">People only</option>
            <option value="agent">Agents only</option>
          </select>
        </div>
      </div>

      {list.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-seal">
          The contributions could not be loaded.
        </p>
      ) : list.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contributions match these filters.</p>
      ) : (
        <ul aria-label="Contributions" className="divide-y divide-rule border-y border-rule">
          {list.data.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
              <span className="font-mono text-xs text-muted-foreground">#{c.number}</span>
              <Link
                to="/c/$ns/$name/contributions/$number"
                params={{ ns, name, number: String(c.number) }}
                className="font-medium underline-offset-4 hover:underline"
              >
                <UserText text={c.title} />
              </Link>
              <StatusStamp status={c.status} />
              {c.agent ? <AgentStamp /> : null}
              <span className="basis-full text-xs text-muted-foreground">
                by <UserText text={authorLabel(c.author, { user: meId, guest: guestId })} /> ·{" "}
                {new Date(c.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 作者设置：谁可以提交 Contribution，以及 invited 模式下的邀请名单。 */
export function ContributionSettings({
  ns,
  name,
  policy,
}: {
  ns: string;
  name: string;
  policy: ContributionPolicy;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const ids = { policy: useId(), user: useId() };
  const [value, setValue] = useState<ContributionPolicy>(policy);
  const [saved, setSaved] = useState<string | null>(null);
  const [user, setUser] = useState("");
  const [error, setError] = useState<string | null>(null);
  const invites = useQuery({
    queryKey: keys.contributionInvites(ns, name),
    queryFn: () => client.contributionInvites(ns, name),
    enabled: value === "invited",
  });
  const refreshInvites = () =>
    qc.invalidateQueries({ queryKey: keys.contributionInvites(ns, name) });

  const save = async () => {
    setError(null);
    setSaved(null);
    try {
      await client.setContributionPolicy(ns, name, value);
      setSaved("Saved.");
      await qc.invalidateQueries({ queryKey: keys.creation(ns, name) });
    } catch {
      setError("The setting could not be saved.");
    }
  };

  const invite = async () => {
    setError(null);
    const id = user.trim();
    try {
      await client.invite(ns, name, id);
      setUser("");
      await refreshInvites();
    } catch (e) {
      setError(
        isApiError(e, "contribution.invite_unknown_user")
          ? "No user has this ID."
          : "The invitation could not be saved.",
      );
    }
  };

  const uninvite = async (id: string) => {
    setError(null);
    try {
      await client.uninvite(ns, name, id);
      await refreshInvites();
    } catch {
      setError("The invitation could not be removed.");
    }
  };

  return (
    <section aria-labelledby="contrib-settings" className="catalog-card space-y-4 p-5 pl-8">
      <h2 id="contrib-settings" className="font-display text-xl">
        Who can contribute
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={ids.policy} className="block text-sm">
            Accept contributions from
          </label>
          <select
            id={ids.policy}
            className={selectClass}
            value={value}
            onChange={(e) => setValue(e.target.value as ContributionPolicy)}
          >
            {(Object.keys(POLICY_LABEL) as ContributionPolicy[]).map((p) => (
              <option key={p} value={p}>
                {POLICY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" size="sm" onClick={() => void save()} disabled={value === policy}>
          Save
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-muted-foreground">
            {saved}
          </span>
        ) : null}
      </div>

      {value === "invited" ? (
        <div className="space-y-2">
          <label htmlFor={ids.user} className="block text-sm">
            Invite a user by ID
          </label>
          <div className="flex gap-2">
            <Input
              id={ids.user}
              value={user}
              placeholder="usr_…"
              className="max-w-xs font-mono"
              onChange={(e) => setUser(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!/^usr_[0-9a-z]{26}$/.test(user.trim())}
              onClick={() => void invite()}
            >
              Invite
            </Button>
          </div>
          {invites.isError ? (
            <p role="alert" className="text-sm text-seal">
              The invitation list could not be loaded.
            </p>
          ) : invites.data && invites.data.items.length > 0 ? (
            <ul aria-label="Invited users" className="space-y-1 text-sm">
              {invites.data.items.map((i) => (
                <li key={i.user} className="flex flex-wrap items-center gap-2">
                  {i.display_name ? <UserText text={i.display_name} /> : null}
                  {i.namespace ? (
                    <span className="text-muted-foreground">
                      <UserText text={i.namespace} />
                    </span>
                  ) : null}
                  <span className="font-mono text-xs text-muted-foreground">{i.user}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${i.display_name ?? i.user}`}
                    onClick={() => void uninvite(i.user)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : invites.data ? (
            <p className="text-sm text-muted-foreground">Nobody is invited yet.</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </section>
  );
}
