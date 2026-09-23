/**
 * 我的作品：当前用户所在 namespace 的全部作品，包括还没有发布的草稿。每行显示类型、地址、
 * 最新版本的状态（未发布 / 公开 / 私有 / 被 yank / 已移除）和草稿最近一次编辑的时间。
 *
 * 待审阅贡献从行内数量链接进入；头像使用受权限保护的读取地址，并按需加载。
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, GitPullRequestArrow, MoreHorizontal, Pencil, Plus, Upload } from "lucide-react";
import { TypeBadge } from "@/components/badges";
import { CreationAvatar } from "@/components/creation-card";
import { SignInRequired } from "@/components/sign-in-required";
import { ListSkeleton, PageSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState, StatePanel } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserText } from "@/components/user-content";
import type { MyCreation } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { formatDate, localized, parseRef } from "@/lib/text";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/me")({ component: MyCreations });

/** 状态一栏：圆点颜色加文字，例如 “Public · v1.2.0”。 */
function releaseStatus(c: MyCreation): { dot: string; text: string } {
  const r = c.latest_release;
  if (!r) return { dot: "bg-text-3", text: "Draft · not published" };
  const vis = r.visibility === "public" ? "Public" : "Private";
  if (r.status === "yanked") return { dot: "bg-warning", text: `${vis} · v${r.label} · yanked` };
  if (r.status === "tombstoned")
    return { dot: "bg-danger", text: `${vis} · v${r.label} · removed` };
  return {
    dot: r.visibility === "public" ? "bg-success" : "bg-blue",
    text: `${vis} · v${r.label}`,
  };
}

/** 草稿最近编辑的时间：当天显示 “Today”，其余显示日期。 */
function editedLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toDateString() === new Date().toDateString() ? "Today" : formatDate(iso);
}

function CreationRow({ c }: { c: MyCreation }) {
  const r = parseRef(c.ref);
  const title = localized(c.display_name) || c.ref;
  const status = releaseStatus(c);
  return (
    <tr className="align-middle">
      <td className="py-3 pr-4 pl-4 sm:pl-5">
        <div className="flex items-center gap-3">
          <CreationAvatar name={title} type={c.type} url={c.avatar_url} className="size-10" />
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold break-words">
                <UserText text={title} />
              </span>
              <TypeBadge type={c.type} />
              {r && (c.open_contributions ?? 0) > 0 ? (
                <Link to="/c/$ns/$name/contributions" params={r} className="text-xs text-blue-text">
                  {c.open_contributions} to review
                </Link>
              ) : null}
              {c.status === "hidden" ? <Badge variant="warning">Hidden</Badge> : null}
              {c.status === "suspended" ? <Badge variant="danger">Suspended</Badge> : null}
            </p>
            <p className="font-mono text-xs break-all text-text-3">{c.ref}</p>
            {/* 窄屏没有状态一栏：放在地址下面。 */}
            <p className="flex items-center gap-1.5 text-xs text-text-2 md:hidden">
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
              {status.text}
            </p>
          </div>
        </div>
      </td>
      <td className="hidden py-3 pr-4 text-sm text-text-2 md:table-cell">
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", status.dot)} />
          {status.text}
        </span>
      </td>
      <td className="hidden py-3 pr-4 text-sm whitespace-nowrap text-text-2 sm:table-cell">
        {c.draft_updated_at ? (
          <time dateTime={c.draft_updated_at}>{editedLabel(c.draft_updated_at)}</time>
        ) : (
          "—"
        )}
      </td>
      <td className="py-3 pr-4 sm:pr-5">
        {r ? (
          <div className="flex items-center justify-end gap-2">
            <Link
              to="/c/$ns/$name/edit"
              params={r}
              aria-label={`Edit ${title}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <Pencil aria-hidden /> Edit
            </Link>
            {c.latest_release ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label={`More for ${title}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to="/c/$ns/$name" params={r}>
                      <Eye aria-hidden /> View
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/c/$ns/$name/contributions" params={r}>
                      <GitPullRequestArrow aria-hidden /> Contributions
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              // 没有发布过的作品没有菜单：留出同样的宽度，让各行的 Edit 对齐。
              <span aria-hidden className="size-8 shrink-0" />
            )}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function MyCreations() {
  const me = useMe();
  const client = useRegistry();
  const list = useQuery({
    queryKey: keys.myCreations,
    queryFn: () => client.myCreations(),
    enabled: !!me.data?.namespace,
  });

  if (me.isPending) return <PageSkeleton label="Loading your creations…" />;
  if (!me.data) return <SignInRequired what="see your creations" />;
  const ns = me.data.namespace;
  const count = list.data?.items.length;

  const actions = (
    <>
      <Link to="/create/import" className={buttonVariants({ variant: "outline" })}>
        <Upload aria-hidden /> Import a card
      </Link>
      <Link to="/create" className={buttonVariants()}>
        <Plus aria-hidden /> New creation
      </Link>
    </>
  );

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">My creations</h1>
          {ns ? (
            <p className="text-sm text-text-2">
              <span className="font-mono">@{ns}</span>
              {count !== undefined
                ? ` · ${count === 1 ? "1 creation" : `${count} creations`}`
                : null}
            </p>
          ) : null}
        </div>
        {ns ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>

      {!ns ? (
        <StatePanel
          icon={Plus}
          tone="primary"
          title="First, choose your name on char.pub"
          description="Your creations live under @name/…, like @rin/alice. You pick it once before your first creation, and can rename it later."
        >
          <Link to="/create" className={buttonVariants()}>
            Choose your @name
          </Link>
        </StatePanel>
      ) : list.isPending ? (
        <ListSkeleton rows={4} label="Loading your creations…" />
      ) : list.isError ? (
        <ErrorState
          title="Your creations could not be loaded"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No creations yet"
          description="Start a character, world or lorebook from scratch, or import a character card you already have."
          action={actions}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <table className="w-full min-w-[20rem] border-collapse text-left">
            <thead className="bg-surface-2 text-xs font-semibold tracking-wide text-text-3 uppercase">
              <tr>
                <th scope="col" className="py-2.5 pr-4 pl-4 font-semibold sm:pl-5">
                  Creation
                </th>
                <th scope="col" className="hidden py-2.5 pr-4 font-semibold md:table-cell">
                  Status
                </th>
                <th scope="col" className="hidden py-2.5 pr-4 font-semibold sm:table-cell">
                  Edited
                </th>
                <th scope="col" className="py-2.5 pr-4 sm:pr-5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t">
              {list.data.items.map((c) => (
                <CreationRow key={c.ref} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
