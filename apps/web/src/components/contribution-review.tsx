/**
 * 一个 Contribution 的详情与审阅（作品 Contributions 标签页里的一页）。
 *
 * 作者看到的是这些变更与**当前草稿**的合并预览：每个变更键一张卡片，标明会被应用、已经在
 * 草稿里、还是冲突（两边改了同一处）。有冲突时不能接受。
 *
 * 改变评级、许可或内容警告的变更是敏感变更，必须逐项勾选确认；没有“全部接受”的捷径，
 * 接受时只把勾选过的键原样提交给服务端。草稿在审阅期间被改过时，服务端返回
 * `draft.version_conflict`，这里提示重新加载预览再决定。
 *
 * 被拒绝时作者填写的理由对提交者和作者都显示。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, GitMerge } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/badges";
import { PageSkeleton } from "@/components/skeletons";
import { ErrorState, NotFound } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  type AcceptedContribution,
  type ContributionDetail,
  type GuestSession,
  isApiError,
} from "@/lib/api";
import { changeAfter, describeKey, draftValue, rawChangeKey } from "@/lib/contribution";
import { keys, useRegistry } from "@/lib/registry";
import { ChangeCard, shortKey } from "./contribution-changes";
import { ContributorCard, DecisionPanel, OutcomePanel } from "./contribution-decision";
import { AgentBadge, authorLabel, timeAgo } from "./contribution-list";
import { UserMarkdown, UserText } from "./user-content";

/**
 * 贡献基于哪个版本、用的什么许可。接口只给出基线 Revision 的 ID：它通常就是最新 Release，
 * 这时读一次最新 Release 的来源（提交表单用的是同一份缓存）就能得到版本号和许可；不是的话
 * 只显示 Revision ID。
 */
function useBaseInfo(
  ns: string,
  name: string,
  c: ContributionDetail | undefined,
  meId: string | undefined,
) {
  const client = useRegistry();
  // 和作品页用同一个键，外框已经读过作品时直接命中缓存。
  const creation = useQuery({
    queryKey: [...keys.creation(ns, name), meId ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !!c,
  });
  const label = creation.data?.latest_release?.label;
  const source = useQuery({
    queryKey: keys.source(ns, name, label ?? ""),
    queryFn: () => client.releaseSource(ns, name, label ?? ""),
    enabled: !!c && !!label,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (!c || !label || !source.data || source.data.revision !== c.base_revision) return null;
  const license = (source.data.creation as { meta?: { license?: unknown } } | null)?.meta?.license;
  return { label, license: typeof license === "string" ? license : null };
}

export function ContributionReview({
  ns,
  name,
  number,
  member,
  meId,
  guest,
}: {
  ns: string;
  name: string;
  number: number;
  member: boolean;
  meId?: string | undefined;
  guest?: GuestSession | null | undefined;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: keys.contribution(ns, name, number),
    queryFn: () => client.contribution(ns, name, number),
  });
  const open = detail.data?.status === "open";
  // “改之前”取当前草稿里的值；只有成员读得到草稿。编辑器用的键不共享，避免互相覆盖缓存。
  const draft = useQuery({
    queryKey: [...keys.draft(ns, name), "review"],
    queryFn: () => client.draft(ns, name),
    enabled: member && open,
    retry: false,
  });
  const base = useBaseInfo(ns, name, detail.data, meId);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedContribution | null>(null);

  if (detail.isPending) return <PageSkeleton label="Loading the contribution…" />;
  if (detail.isError) {
    return isApiError(detail.error) && detail.error.status === 404 ? (
      <NotFound
        level={2}
        what={`#${number}`}
        description="This contribution does not exist or is not visible to you."
      />
    ) : (
      <ErrorState
        title="The contribution could not be loaded"
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const c = detail.data;
  const preview = c.preview;
  const byKey = new Map(c.changes.map((raw) => [rawChangeKey(raw), raw]));
  const outcomes = preview?.outcomes ?? [];
  const mustConfirm = outcomes.filter((o) => o.sensitive && o.state === "applied");
  const allConfirmed = mustConfirm.every((o) => confirmed.has(o.key));
  const isAuthor =
    ("user" in c.author && c.author.user === meId) ||
    ("guest_id" in c.author && c.author.guest_id === guest?.guest.id);
  const author = authorLabel(c.author, { user: meId, guest: guest?.guest.id });
  const working = draft.data?.working;

  const reload = async () => {
    setStale(false);
    setError(null);
    setConfirmed(new Set());
    await Promise.all([detail.refetch(), member ? draft.refetch() : null]);
  };

  const refreshLists = () =>
    qc.invalidateQueries({ queryKey: [...keys.creation(ns, name), "contributions"] });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const accept = () =>
    run(async () => {
      try {
        // 只提交逐项勾选过的键，顺序与预览一致。
        const keysToConfirm = mustConfirm.map((o) => o.key).filter((k) => confirmed.has(k));
        setAccepted(await client.acceptContribution(ns, name, number, keysToConfirm));
        await Promise.all([
          detail.refetch(),
          refreshLists(),
          qc.invalidateQueries({ queryKey: keys.draft(ns, name) }),
        ]);
      } catch (e) {
        if (isApiError(e, "draft.version_conflict") || isApiError(e, "contribution.conflict")) {
          setStale(true);
        } else if (isApiError(e, "contribution.sensitive_unconfirmed")) {
          setError("Confirm every sensitive change before accepting.");
        } else if (isApiError(e, "contribution.rights_ack_required")) {
          setError(
            "The license changed since this was submitted; the contributor must grant rights explicitly.",
          );
        } else if (isApiError(e, "contribution.not_open")) {
          await detail.refetch();
        } else {
          setError("The contribution could not be accepted. Try again.");
        }
      }
    });

  const reject = (reason: string) =>
    run(async () => {
      try {
        await client.rejectContribution(ns, name, number, reason);
        await Promise.all([detail.refetch(), refreshLists()]);
      } catch {
        setError("The contribution could not be rejected.");
      }
    });

  const withdraw = () =>
    run(async () => {
      try {
        await client.withdrawContribution(ns, name, number);
        await Promise.all([detail.refetch(), refreshLists()]);
      } catch {
        setError("The contribution could not be withdrawn.");
      }
    });

  const changeCount = c.changes.length;
  const decided = c.decided_at ? ` · decided ${timeAgo(c.decided_at)}` : "";

  return (
    <article className="space-y-6">
      <Link
        to="/c/$ns/$name/contributions"
        params={{ ns, name }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-text hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" /> All contributions
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-2xl font-bold text-balance break-words">
            <span className="mr-2 font-normal text-text-3">#{c.number}</span>
            <UserText text={c.title} />
          </h2>
          <StatusBadge status={c.status} />
          {c.agent ? <AgentBadge /> : null}
        </div>
        <p className="text-sm text-text-3">
          <UserText text={author} /> proposed{" "}
          {changeCount === 1 ? "1 change" : `${changeCount} changes`} on{" "}
          {base ? (
            <span className="font-mono">v{base.label}</span>
          ) : (
            <>
              revision <span className="font-mono break-all">{c.base_revision}</span>
            </>
          )}{" "}
          ·{" "}
          <time dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()}>
            {timeAgo(c.created_at)}
          </time>
          {decided}
          {base?.license ? (
            <>
              {" "}
              · licensed <span className="font-mono">{base.license}</span>
            </>
          ) : null}
        </p>
        {c.description ? (
          <div className="max-w-prose text-text-2">
            <UserMarkdown text={c.description} />
          </div>
        ) : null}
      </header>

      {c.status === "rejected" ? (
        <section
          aria-labelledby="c-rejected"
          className="space-y-1 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3"
        >
          <h3 id="c-rejected" className="text-sm font-semibold text-danger">
            Rejected
          </h3>
          {c.decision_reason ? (
            <p className="text-sm break-words whitespace-pre-wrap">
              <UserText text={c.decision_reason} />
            </p>
          ) : (
            <p className="text-sm text-text-2">The author didn't leave a reason.</p>
          )}
        </section>
      ) : null}

      {accepted ? (
        <section
          role="status"
          aria-labelledby="c-accepted"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-success/40 bg-success-soft px-4 py-3"
        >
          <GitMerge aria-hidden className="size-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <h3 id="c-accepted" className="text-sm font-semibold">
              Accepted
            </h3>
            <p className="text-sm text-text-2">
              The changes are in your draft (revision{" "}
              <span className="font-mono text-xs">{accepted.revision}</span>). Publish a new version
              to share them.
            </p>
          </div>
          <Link
            to="/c/$ns/$name/edit"
            params={{ ns, name }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open the editor
          </Link>
        </section>
      ) : null}

      {stale ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/50 bg-warning-soft px-4 py-3 text-sm"
        >
          <span className="min-w-0 flex-1">
            The draft changed while you were reviewing. Reload the preview and check again.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Reload the preview
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {preview ? (
          <section aria-labelledby="c-preview" className="min-w-0 space-y-3">
            <h3 id="c-preview" className="text-base font-semibold">
              {member ? "Changes against your current draft" : "Changes against the author's draft"}
            </h3>
            {preview.error ? (
              <p role="alert" className="text-sm text-danger">
                These changes can no longer be applied to the draft ({preview.error}).
              </p>
            ) : preview.conflicts.length > 0 ? (
              <p role="alert" className="text-sm text-danger">
                {preview.conflicts.length === 1
                  ? "1 change conflicts with the draft."
                  : `${preview.conflicts.length} changes conflict with the draft.`}{" "}
                It cannot be accepted as it is.
              </p>
            ) : mustConfirm.length > 0 && member ? (
              <p className="text-sm text-text-2">
                {mustConfirm.length === 1
                  ? "1 sensitive change needs"
                  : `${mustConfirm.length} sensitive changes need`}{" "}
                your confirmation, one by one.
              </p>
            ) : null}
            <ul aria-label="Merge preview" className="space-y-3">
              {outcomes.map((o) => (
                <ChangeCard
                  key={o.key}
                  outcome={o}
                  before={member ? draftValue(working, o.key) : null}
                  after={changeAfter(byKey.get(o.key))}
                  canConfirm={member && open}
                  confirmed={confirmed.has(o.key)}
                  onConfirm={(v) =>
                    setConfirmed((s) => {
                      const next = new Set(s);
                      if (v) next.add(o.key);
                      else next.delete(o.key);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </section>
        ) : (
          <section aria-labelledby="c-changes" className="min-w-0 space-y-3">
            <h3 id="c-changes" className="text-base font-semibold">
              Changes
            </h3>
            <ul aria-label="Changes" className="space-y-3">
              {c.changes.map((raw, i) => {
                const key = rawChangeKey(raw) ?? `change-${i}`;
                const after = changeAfter(raw);
                return (
                  <li
                    key={key}
                    aria-label={describeKey(key)}
                    className="overflow-hidden rounded-lg border bg-surface"
                  >
                    <p className="border-b px-4 py-2.5 font-mono text-sm font-medium break-all">
                      {shortKey(key)}
                    </p>
                    {after ? (
                      <p className="px-4 py-2 text-sm break-words whitespace-pre-wrap">
                        <UserText text={"text" in after ? after.text : after.value} />
                      </p>
                    ) : (
                      <p className="px-4 py-2 text-sm text-text-3">Removed.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <aside aria-label="Decision" className="space-y-4 lg:sticky lg:top-6">
          {open && member ? (
            <DecisionPanel
              preview={preview}
              mustConfirm={mustConfirm.length}
              confirmedCount={mustConfirm.filter((o) => confirmed.has(o.key)).length}
              author={author}
              busy={busy}
              canAccept={!busy && !stale && !!preview?.mergeable && allConfirmed}
              onAccept={() => void accept()}
              onReject={(reason) => void reject(reason)}
            />
          ) : (
            <OutcomePanel
              detail={c}
              isAuthor={isAuthor}
              member={member}
              ns={ns}
              name={name}
              busy={busy}
              onWithdraw={open && isAuthor && !member ? () => void withdraw() : undefined}
            />
          )}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <ContributorCard detail={c} label={author} />
        </aside>
      </div>
    </article>
  );
}
