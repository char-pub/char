/**
 * 一个 Contribution 的详情与审阅。
 *
 * 作者看到的是这些变更与**当前草稿**的合并预览：每个变更键一行，标明会被应用、已经在
 * 草稿里、还是冲突（两边改了同一处）。有冲突时不能接受。
 *
 * 改变评级、许可或内容警告的变更是敏感变更，必须逐项勾选确认；没有“全部接受”的捷径，
 * 接受时只把勾选过的键原样提交给服务端。草稿在审阅期间被改过时，服务端返回
 * `draft.version_conflict`，这里提示重新加载预览再决定。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type AcceptedContribution,
  type ContributionDetail,
  type GuestSession,
  isApiError,
} from "@/lib/api";
import { changeAfter, describeKey, rawChangeKey } from "@/lib/contribution";
import { keys, useRegistry } from "@/lib/registry";
import { AgentStamp, authorLabel, StatusStamp } from "./contribution-list";
import { UserMarkdown, UserText } from "./user-content";

type Outcome = NonNullable<ContributionDetail["preview"]>["outcomes"][number];

const STATE_TEXT: Record<Outcome["state"], string> = {
  applied: "will apply",
  already_applied: "already in the draft",
  conflict: "conflict",
};

const STATE_CLASS: Record<Outcome["state"], string> = {
  applied: "border-moss text-moss",
  already_applied: "border-rule text-muted-foreground",
  conflict: "border-seal bg-seal-soft text-seal",
};

const CONFLICT_REASON: Record<string, string> = {
  diverged: "This was also changed in the draft since the contribution was made.",
  slot_missing: "The asset slot this change adds to no longer exists.",
};

const OP_TEXT: Record<string, string> = {
  add: "adds",
  modify: "changes",
  remove: "removes",
  set: "sets",
  unset: "clears",
};

function ChangeRow({
  outcome,
  raw,
  canConfirm,
  confirmed,
  onConfirm,
}: {
  outcome: Outcome;
  raw: unknown;
  canConfirm: boolean;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  const id = useId();
  const after = changeAfter(raw);
  const needsConfirm = outcome.sensitive && outcome.state === "applied";
  return (
    <li
      className="space-y-2 py-3"
      data-key={outcome.key}
      data-state={outcome.state}
      aria-label={`${describeKey(outcome.key)}: ${STATE_TEXT[outcome.state]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{describeKey(outcome.key)}</span>
        <span className="text-sm text-muted-foreground">{OP_TEXT[outcome.op] ?? outcome.op}</span>
        <span className={`stamp ${STATE_CLASS[outcome.state]}`}>
          {outcome.state === "conflict" ? <AlertTriangle aria-hidden className="size-3" /> : null}
          {STATE_TEXT[outcome.state]}
        </span>
        {outcome.sensitive ? (
          <span className="stamp border-amber bg-amber-soft text-foreground">
            <ShieldAlert aria-hidden className="size-3" /> sensitive
          </span>
        ) : null}
      </div>
      {outcome.state === "conflict" ? (
        <p className="text-sm text-seal">
          {CONFLICT_REASON[outcome.reason ?? "diverged"] ?? CONFLICT_REASON.diverged}
        </p>
      ) : null}
      {after ? (
        "text" in after ? (
          <div className="rounded-sm border border-rule bg-card p-3 text-sm">
            <UserMarkdown text={after.text} />
          </div>
        ) : (
          <p className="font-mono text-sm">
            → <UserText text={after.value} />
          </p>
        )
      ) : null}
      {needsConfirm && canConfirm ? (
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirm(e.target.checked)}
          />
          I have reviewed this {describeKey(outcome.key)} change and accept it
        </label>
      ) : null}
    </li>
  );
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
  const reasonId = useId();
  const detail = useQuery({
    queryKey: keys.contribution(ns, name, number),
    queryFn: () => client.contribution(ns, name, number),
  });
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedContribution | null>(null);

  if (detail.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (detail.isError) {
    return isApiError(detail.error) && detail.error.status === 404 ? (
      <p className="text-muted-foreground">
        This contribution does not exist or is not visible to you.
      </p>
    ) : (
      <p role="alert" className="text-seal">
        The contribution could not be loaded.
      </p>
    );
  }
  const c = detail.data;
  const preview = c.preview;
  const byKey = new Map(c.changes.map((raw) => [rawChangeKey(raw), raw]));
  const mustConfirm = (preview?.outcomes ?? []).filter((o) => o.sensitive && o.state === "applied");
  const allConfirmed = mustConfirm.every((o) => confirmed.has(o.key));
  const isAuthor =
    ("user" in c.author && c.author.user === meId) ||
    ("guest_id" in c.author && c.author.guest_id === guest?.guest.id);

  const reload = async () => {
    setStale(false);
    setError(null);
    setConfirmed(new Set());
    await detail.refetch();
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
        await Promise.all([detail.refetch(), refreshLists()]);
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

  const reject = () =>
    run(async () => {
      try {
        await client.rejectContribution(ns, name, number, reason.trim());
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

  return (
    <article className="max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="text-sm">
          <Link to="/c/$ns/$name/contributions" params={{ ns, name }} className="underline">
            Contributions
          </Link>{" "}
          / #{c.number}
        </p>
        <h1 className="text-4xl">
          <UserText text={c.title} />
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusStamp status={c.status} />
          {c.agent ? <AgentStamp /> : null}
          <span className="text-muted-foreground">
            by <UserText text={authorLabel(c.author, { user: meId, guest: guest?.guest.id })} /> ·{" "}
            {new Date(c.created_at).toLocaleString()}
          </span>
        </div>
        {c.description ? (
          <div className="max-w-prose text-muted-foreground">
            <UserMarkdown text={c.description} />
          </div>
        ) : null}
      </header>

      {accepted ? (
        <section role="status" className="catalog-card space-y-2 p-5 pl-8">
          <h2 className="font-display text-xl">Accepted</h2>
          <p className="text-sm text-muted-foreground">
            The changes are in your draft (revision{" "}
            <span className="font-mono text-xs">{accepted.revision}</span>). Publish a new version
            to share them.
          </p>
          <Link to="/c/$ns/$name/edit" params={{ ns, name }} className="text-sm underline">
            Open the editor
          </Link>
        </section>
      ) : null}

      {stale ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-sm border border-amber/60 bg-amber-soft px-4 py-2 text-sm"
        >
          <span>
            The draft changed while you were reviewing. Reload the preview and check again.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Reload the preview
          </Button>
        </div>
      ) : null}

      {preview ? (
        <section aria-labelledby="c-preview" className="space-y-3">
          <h2 id="c-preview" className="text-2xl">
            Changes against your current draft
          </h2>
          {preview.error ? (
            <p role="alert" className="text-sm text-seal">
              These changes can no longer be applied to the draft ({preview.error}).
            </p>
          ) : preview.conflicts.length > 0 ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-seal">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {preview.conflicts.length === 1
                ? "1 change conflicts with the draft."
                : `${preview.conflicts.length} changes conflict with the draft.`}{" "}
              It cannot be accepted as it is.
            </p>
          ) : mustConfirm.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {mustConfirm.length === 1
                ? "1 sensitive change needs"
                : `${mustConfirm.length} sensitive changes need`}{" "}
              your confirmation, one by one.
            </p>
          ) : null}
          <ul aria-label="Merge preview" className="divide-y divide-rule border-y border-rule">
            {preview.outcomes.map((o) => (
              <ChangeRow
                key={o.key}
                outcome={o}
                raw={byKey.get(o.key)}
                canConfirm={member && c.status === "open"}
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
        <section aria-labelledby="c-changes" className="space-y-3">
          <h2 id="c-changes" className="text-2xl">
            Changes
          </h2>
          <ul className="divide-y divide-rule border-y border-rule">
            {c.changes.map((raw) => {
              const key = rawChangeKey(raw) ?? "change";
              const after = changeAfter(raw);
              return (
                <li key={key} className="space-y-1 py-3 text-sm">
                  <span className="font-medium">{describeKey(key)}</span>
                  {after && "text" in after ? <UserMarkdown text={after.text} /> : null}
                  {after && "value" in after ? (
                    <p className="font-mono">
                      → <UserText text={after.value} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {c.status === "open" && member ? (
        <section aria-labelledby="c-decide" className="space-y-4">
          <h2 id="c-decide" className="sr-only">
            Decide
          </h2>
          <Button
            type="button"
            disabled={busy || stale || !preview?.mergeable || !allConfirmed}
            onClick={() => void accept()}
          >
            Accept into the draft
          </Button>
          <div className="space-y-2">
            <label htmlFor={reasonId} className="block text-sm">
              Reason for rejecting
            </label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || reason.trim().length === 0}
              onClick={() => void reject()}
            >
              Reject
            </Button>
          </div>
        </section>
      ) : null}

      {c.status === "open" && isAuthor && !member ? (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void withdraw()}>
          Withdraw this contribution
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </article>
  );
}
