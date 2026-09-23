/**
 * 贡献详情右侧的面板：
 *
 * - `DecisionPanel`：作者对 open 状态的贡献做决定。先汇总能否干净合并、敏感变更确认了几个、
 *   有没有冲突，再给出“接受进草稿”和“写明理由后拒绝”。接受不会发布。
 * - `OutcomePanel`：其他情况下的状态说明；提交者可以在作者决定之前撤回。
 * - `ContributorCard`：提交者是谁、是否由 Agent 写的、接受后怎么署名。
 */
import { Link } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, CircleDashed, GitMerge, X } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import { Initials } from "@/components/account-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { ContributionDetail } from "@/lib/api";
import { formatDate } from "@/lib/text";
import { cn } from "@/lib/utils";
import { UserText } from "./user-content";

type Preview = ContributionDetail["preview"];

function Check({
  ok,
  tone = ok ? "ok" : "todo",
  children,
}: {
  ok: boolean;
  tone?: "ok" | "todo" | "bad";
  children: React.ReactNode;
}) {
  const Icon = tone === "ok" ? CircleCheck : tone === "bad" ? CircleAlert : CircleDashed;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "ok" ? "text-success" : tone === "bad" ? "text-danger" : "text-text-3",
        )}
      />
      <span className={cn(tone === "bad" && "text-danger")}>{children}</span>
    </li>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function DecisionPanel({
  preview,
  mustConfirm,
  confirmedCount,
  author,
  busy,
  canAccept,
  onAccept,
  onReject,
}: {
  preview: Preview;
  /** 需要逐项确认的敏感变更数。 */
  mustConfirm: number;
  confirmedCount: number;
  /** 提交者的显示文字，拒绝理由会给这个人看。 */
  author: string;
  busy: boolean;
  canAccept: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
}) {
  const reasonId = useId();
  const helpId = useId();
  const [reason, setReason] = useState("");
  const outcomes = preview?.outcomes ?? [];
  const applied = outcomes.filter((o) => o.state === "applied").length;
  const already = outcomes.filter((o) => o.state === "already_applied").length;
  const conflicts = preview?.conflicts.length ?? 0;

  return (
    <section aria-labelledby="c-decide" className="space-y-4 rounded-lg border bg-surface p-5">
      <h2 id="c-decide" className="text-base font-semibold">
        Your decision
      </h2>
      <ul aria-label="Checks" className="space-y-2">
        {!preview ? (
          <Check ok={false} tone="bad">
            The merge preview is not available.
          </Check>
        ) : preview.error ? (
          <Check ok={false} tone="bad">
            These changes can no longer be applied to the draft.
          </Check>
        ) : (
          <>
            {applied > 0 ? (
              <Check ok={conflicts === 0}>
                {plural(applied, "change")} will apply{conflicts === 0 ? " cleanly" : ""}
              </Check>
            ) : null}
            {already > 0 ? (
              <Check ok>{plural(already, "change")} already in the draft</Check>
            ) : null}
          </>
        )}
        {mustConfirm > 0 ? (
          <Check ok={confirmedCount === mustConfirm}>
            {confirmedCount} of {plural(mustConfirm, "sensitive change")} confirmed
          </Check>
        ) : null}
        {preview && !preview.error ? (
          conflicts === 0 ? (
            <Check ok>No conflicts with your draft</Check>
          ) : (
            <Check ok={false} tone="bad">
              {plural(conflicts, "conflict")} with your draft
            </Check>
          )
        ) : null}
      </ul>
      <Button type="button" className="w-full" disabled={!canAccept} onClick={onAccept}>
        <GitMerge aria-hidden /> Accept into the draft
      </Button>
      <p className="text-xs text-text-3">
        Accepting doesn't publish. You'll review the draft and publish a new version from the
        editor.
      </p>
      <Separator />
      <div className="space-y-2">
        <label htmlFor={reasonId} className="block text-sm font-semibold">
          Or reject with a reason
        </label>
        <Textarea
          id={reasonId}
          value={reason}
          maxLength={2000}
          aria-describedby={helpId}
          onChange={(e) => setReason(e.target.value)}
        />
        <p id={helpId} className="text-xs text-text-3">
          <UserText text={author} /> will see this reason.
        </p>
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          disabled={busy || reason.trim().length === 0}
          onClick={() => onReject(reason.trim())}
        >
          <X aria-hidden /> Reject
        </Button>
      </div>
    </section>
  );
}

/** 不需要作者做决定时的状态说明。 */
export function OutcomePanel({
  detail: c,
  isAuthor,
  member,
  ns,
  name,
  busy,
  onWithdraw,
}: {
  detail: ContributionDetail;
  isAuthor: boolean;
  member: boolean;
  ns: string;
  name: string;
  busy: boolean;
  /** 提交者在作者决定之前可以撤回。 */
  onWithdraw?: (() => void) | undefined;
}) {
  const when = c.decided_at ? formatDate(c.decided_at) : null;
  let title: string;
  let body: React.ReactNode;
  switch (c.status) {
    case "open":
      title = "Waiting for the author";
      body = isAuthor
        ? "The author reviews your changes against their current draft. You can withdraw it until they decide."
        : "The author hasn't decided yet.";
      break;
    case "accepted":
      title = member ? "In your draft" : "In the author's draft";
      body = `Accepted${when ? ` on ${when}` : ""}. The changes are credited in the next release.`;
      break;
    case "rejected":
      title = "Not taken";
      body = `The author decided not to take these changes${when ? ` on ${when}` : ""}.`;
      break;
    case "withdrawn":
      title = "Withdrawn";
      body = `The contributor withdrew this${when ? ` on ${when}` : ""}.`;
      break;
  }
  return (
    <section aria-labelledby="c-outcome" className="space-y-3 rounded-lg border bg-surface p-5">
      <h2 id="c-outcome" className="text-base font-semibold">
        {title}
      </h2>
      <p className="text-sm text-text-2">{body}</p>
      {c.status === "accepted" && c.result_revision ? (
        <p className="text-xs text-text-3">
          Revision <span className="font-mono break-all">{c.result_revision}</span>
        </p>
      ) : null}
      {c.status === "accepted" && member ? (
        <Link
          to="/c/$ns/$name/edit"
          params={{ ns, name }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open the editor
        </Link>
      ) : null}
      {onWithdraw ? (
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          disabled={busy}
          onClick={onWithdraw}
        >
          Withdraw this contribution
        </Button>
      ) : null}
    </section>
  );
}

export function ContributorCard({
  detail: c,
  label,
}: {
  detail: ContributionDetail;
  /** `authorLabel` 的结果（当前用户是 “you”）。 */
  label: string;
}) {
  const a = c.author;
  const guest = "guest_id" in a;
  const initialsOf = guest ? a.display_name : (a.namespace?.replace(/^@/, "") ?? a.display_name);
  return (
    <section
      aria-labelledby="c-contributor"
      className="space-y-3 rounded-lg bg-surface-2 p-5 text-sm"
    >
      <h2 id="c-contributor" className="font-semibold">
        Contributor
      </h2>
      <div className="flex items-center gap-3">
        <Initials name={initialsOf ?? "?"} />
        <div className="min-w-0">
          <p className="font-medium break-words">
            <UserText text={label} />
          </p>
          <p className="text-xs text-text-3">
            {guest ? "Verified guest" : "Signed in"} ·{" "}
            {c.agent ? "written by an agent" : "written by a person"}
          </p>
        </div>
      </div>
      {c.status === "open" || c.status === "accepted" ? (
        <p className="text-xs text-text-2">
          {c.status === "open" ? "If accepted, the contributor is" : "The contributor is"} credited
          on the next release, separately from the author.
        </p>
      ) : null}
    </section>
  );
}
