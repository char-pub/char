/**
 * 作品的 Contributions 标签页：顶部一条开放度说明（谁能提修改、接受后只进草稿），下面是按状态
 * 和提交者类型筛选的列表。作品的成员看到全部，其他登录用户和访客只看到自己提交的，匿名
 * 读者看不到任何条目。
 *
 * 开放度和邀请名单在作品的 Settings 标签里设置，这里只给所有者一个入口。
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  ChevronRight,
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  Lock,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { SignInButton } from "@/components/sign-in";
import { ListSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState, NotFound } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  type ContributionPolicy,
  type ContributionQuery,
  type ContributionStatus,
  type ContributionSummary,
  isApiError,
} from "@/lib/api";
import { keys, useGuest, useMe, useRegistry } from "@/lib/registry";
import { timeAgo } from "@/lib/text";
import { cn } from "@/lib/utils";
import { UserText } from "./user-content";

export const STATUS_LABEL: Record<ContributionStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const POLICY_LABEL: Record<ContributionPolicy, string> = {
  anyone: "Anyone, including verified guests",
  "signed-in": "Signed-in users",
  invited: "Invited users only",
  closed: "Nobody (closed)",
};

/** 说明条里“现在谁能提修改”的句子。 */
const POLICY_SENTENCE: Record<ContributionPolicy, string> = {
  anyone: "Anyone can suggest changes, including verified guests.",
  "signed-in": "Signed-in users can suggest changes.",
  invited: "Only invited users can suggest changes.",
  closed: "This creation is not accepting contributions right now.",
};

/** 状态图标的颜色：open 绿、accepted 紫（已合并）、rejected 红、withdrawn 灰。 */
const STATUS_ICON: Record<
  ContributionStatus,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  open: { icon: GitPullRequestArrow, className: "text-success" },
  accepted: { icon: GitMerge, className: "text-purple-text" },
  rejected: { icon: GitPullRequestClosed, className: "text-danger" },
  withdrawn: { icon: GitPullRequestClosed, className: "text-text-3" },
};

export function StatusIcon({
  status,
  className,
}: {
  status: ContributionStatus;
  className?: string;
}) {
  const s = STATUS_ICON[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex shrink-0", s.className, className)}>
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** Agent 提交的 Contribution 的标记：用 Agent Token 提交的一律带这个标记，客户端改不掉。 */
export function AgentBadge() {
  return (
    <Badge variant="purple" title="Submitted with an agent token or marked as written by an agent">
      <Bot aria-hidden /> Agent
    </Badge>
  );
}

/**
 * 提交者的显示文字。当前用户（登录用户或访客）显示 “you”；访客一律写成 “guest · 名字”，
 * 不能看起来像登录用户；登录用户显示显示名与 namespace，都没有时才退回用户 ID。
 */
export function authorLabel(
  author: ContributionSummary["author"],
  me?: { user?: string | undefined; guest?: string | undefined },
) {
  if ("guest_id" in author) {
    return author.guest_id === me?.guest ? "you" : `guest · ${author.display_name}`;
  }
  if (author.user === me?.user) return "you";
  if (author.display_name && author.namespace)
    return `${author.display_name} (${author.namespace})`;
  return author.display_name ?? author.namespace ?? `user ${author.user}`;
}

type AgentFilter = "all" | "agent" | "human";

const STATUSES = Object.keys(STATUS_LABEL) as ContributionStatus[];

/** 列表的一行：状态图标、标题（整行可点）、Agent 标记、编号、提交者、时间。 */
function ContributionRow({
  ns,
  name,
  c,
  me,
}: {
  ns: string;
  name: string;
  c: ContributionSummary;
  me: { user?: string | undefined; guest?: string | undefined };
}) {
  return (
    <li className="relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60 sm:px-5">
      <StatusIcon status={c.status} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/c/$ns/$name/contributions/$number"
            params={{ ns, name, number: String(c.number) }}
            className="font-semibold break-words text-text outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40"
          >
            <UserText text={c.title} />
            {c.has_conflicts ? <Badge variant="warning">Conflicts</Badge> : null}
          </Link>
          {c.agent ? <AgentBadge /> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-3">
          <span className="font-mono">#{c.number}</span>
          <span>
            by <UserText text={authorLabel(c.author, me)} />
          </span>
          <span aria-hidden>·</span>
          {c.change_count !== undefined ? <span>{c.change_count} changes · </span> : null}
          <time dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()}>
            {timeAgo(c.created_at)}
          </time>
        </p>
      </div>
      <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-text-3" />
    </li>
  );
}

export function ContributionList({
  ns,
  name,
  meId,
  guestId,
  member = false,
}: {
  ns: string;
  name: string;
  meId?: string | undefined;
  /** 以访客身份查看时的访客 ID：只会列出这个访客自己提交的。 */
  guestId?: string | undefined;
  /** 作品成员看到全部提交，空状态的说法不同。 */
  member?: boolean;
}) {
  const client = useRegistry();
  const [status, setStatus] = useState<ContributionStatus>("open");
  const [agent, setAgent] = useState<AgentFilter>("all");
  const q: ContributionQuery = {
    status,
    agent: agent === "all" ? undefined : agent === "agent",
  };
  // 用单独的键：其他地方可能用普通查询读同一个列表（例如标签上的数量），两种缓存结构不能混用。
  const list = useInfiniteQuery({
    queryKey: [...keys.contributions(ns, name, q), "pages"],
    queryFn: ({ pageParam }) => client.contributions(ns, name, { ...q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const me = { user: meId, guest: guestId };

  return (
    <section aria-label="Contribution list" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="inline-flex max-w-full min-w-0 flex-wrap gap-1 rounded-md bg-surface-2 p-1">
          <legend className="sr-only">Status</legend>
          {STATUSES.map((s) => {
            const active = s === status;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(s)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-sm font-medium text-text-2 transition-colors outline-none hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  active && "bg-surface text-text",
                )}
              >
                {STATUS_LABEL[s]}
                {list.data?.pages[0]?.counts ? ` (${list.data.pages[0].counts[s]})` : ""}
                {/* 接口不返回各状态的总数：只在当前筛选上显示已经读到的条数。 */}
                {active && list.isSuccess ? (
                  <span className="text-xs text-text-3 tabular-nums">
                    {items.length}
                    {list.hasNextPage ? "+" : ""}
                  </span>
                ) : null}
              </button>
            );
          })}
        </fieldset>
        <NativeSelect
          aria-label="Submitted by"
          className="w-auto min-w-48"
          value={agent}
          onChange={(e) => setAgent(e.target.value as AgentFilter)}
        >
          <option value="all">People and agents</option>
          <option value="human">People</option>
          <option value="agent">Agents</option>
        </NativeSelect>
      </div>

      {list.isPending ? (
        <ListSkeleton rows={3} label="Loading contributions…" />
      ) : list.isError ? (
        <ErrorState
          title="The contributions could not be loaded"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={GitPullRequestArrow}
          title={`No ${STATUS_LABEL[status].toLowerCase()} contributions`}
          description={
            agent !== "all"
              ? "Nothing matches these filters."
              : member
                ? "When someone proposes a change, it shows up here for you to review."
                : "Contributions you submit to this creation show up here."
          }
          action={
            agent !== "all" ? (
              <Button variant="outline" onClick={() => setAgent("all")}>
                Show people and agents
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul
            aria-label="Contributions"
            className="divide-y divide-border overflow-hidden rounded-lg border bg-surface"
          >
            {items.map((c) => (
              <ContributionRow key={c.id} ns={ns} name={name} c={c} me={me} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * 标签页顶部的说明条：现在谁能提修改、接受的修改只进草稿不会自动发布。所有者看到开放度
 * 设置的入口，其他人在可以提交时看到 “Propose a change”。
 */
export function ContributionPolicyNote({
  ns,
  name,
  policy,
  member,
  canPropose,
}: {
  ns: string;
  name: string;
  policy: ContributionPolicy;
  member: boolean;
  canPropose: boolean;
}) {
  const draftNote =
    policy === "closed"
      ? null
      : member
        ? "Accepted changes go into your draft — nothing is published until you publish."
        : "Accepted changes go into the author's draft — nothing is published until they publish.";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-surface px-4 py-3 sm:px-5">
      <Users aria-hidden className="size-4 shrink-0 text-text-3" />
      <p className="min-w-0 flex-1 text-sm text-text-2">
        {POLICY_SENTENCE[policy]}
        {draftNote ? ` ${draftNote}` : null}
      </p>
      {member ? (
        // 开放度和邀请名单在作品的 Settings 标签里设置，这里只给入口。
        <Link
          to="/c/$ns/$name/settings"
          params={{ ns, name }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <SlidersHorizontal aria-hidden /> Who can contribute
        </Link>
      ) : canPropose ? (
        <Link
          to="/c/$ns/$name/contributions/new"
          params={{ ns, name }}
          className={buttonVariants({ size: "sm" })}
        >
          <GitPullRequestArrow aria-hidden /> Propose a change
        </Link>
      ) : null}
    </div>
  );
}

/** Contributions 标签页的全部内容（作品头部和标签栏由外框提供）。 */
export function ContributionsTab({ ns, name }: { ns: string; name: string }) {
  const client = useRegistry();
  const me = useMe();
  const guest = useGuest(!me.isPending && !me.data);
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });

  if (me.isPending || detail.isPending) {
    return <ListSkeleton rows={3} label="Loading contributions…" />;
  }
  if (detail.isError) {
    return isApiError(detail.error) && detail.error.status === 404 ? (
      <NotFound what={`@${ns}/${name}`} level={2} />
    ) : (
      <ErrorState
        title="This creation could not be loaded"
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const d = detail.data;
  const member = !!me.data && me.data.namespace === ns;
  const canPropose =
    !member && d.contribution_policy !== "closed" && d.latest_release !== undefined;

  return (
    <div className="space-y-5">
      <ContributionPolicyNote
        ns={ns}
        name={name}
        policy={d.contribution_policy}
        member={member}
        canPropose={canPropose}
      />
      {me.data ? (
        <ContributionList ns={ns} name={name} meId={me.data.id} member={member} />
      ) : guest.data ? (
        <ContributionList ns={ns} name={name} guestId={guest.data.guest.id} />
      ) : guest.isPending ? (
        <ListSkeleton rows={2} label="Loading contributions…" />
      ) : (
        <EmptyState
          icon={Lock}
          title="Contributions are private"
          description="Only the author and the person who submitted a contribution can see it. Sign in to see yours."
          action={<SignInButton variant="outline" />}
        />
      )}
    </div>
  );
}
