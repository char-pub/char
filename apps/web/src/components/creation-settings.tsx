/**
 * 作品设置里的“谁能提修改”：贡献开放度只在这里设置（编辑器里不再有第二个入口，避免两边的值
 * 对不上）。选 Invited 时管理邀请名单：按对方的个人 @namespace 添加，名单只有作者能看到。
 * 名单只显示 @namespace，不显示登录方式带来的显示名（那可能是真名）。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, UserPlus } from "lucide-react";
import { useId, useState } from "react";
import { Initials } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/sonner";
import { type ContributionPolicy, isApiError } from "@/lib/api";
import { isReadOnlyError } from "@/lib/read-only";
import { keys, useRegistry } from "@/lib/registry";
import { formatDate } from "@/lib/text";
import { refreshCreation } from "./creation-context";
import { FactCard } from "./creation-facts";
import { RadioCard } from "./radio-card";
import { ListSkeleton } from "./skeletons";

export const POLICY_OPTIONS: { value: ContributionPolicy; title: string; description: string }[] = [
  {
    value: "anyone",
    title: "Anyone",
    description: "Including guests who verify an email address.",
  },
  { value: "signed-in", title: "Signed-in users", description: "Anyone with a char.pub account." },
  { value: "invited", title: "Invited people", description: "Only the people you add below." },
  { value: "closed", title: "Nobody", description: "Turn contributions off." },
];

const NAMESPACE_RE = /^@?[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function writeError(e: unknown, fallback: string): string {
  if (isReadOnlyError(e)) return "char.pub is read-only for maintenance. Try again later.";
  if (isApiError(e) && e.status === 429)
    return "Too many changes in a short time. Try again later.";
  return fallback;
}

export function ContributionPolicySettings({
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
  const legend = useId();
  // 选中后立即保存；保存失败时退回原来的值。
  const [value, setValue] = useState<ContributionPolicy>(policy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: ContributionPolicy) => {
    if (next === value || busy) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      await client.setContributionPolicy(ns, name, next);
      await refreshCreation(qc, ns, name);
      toast.success(`Contributions: ${POLICY_OPTIONS.find((p) => p.value === next)?.title}`);
    } catch (e) {
      setValue(prev);
      setError(writeError(e, "The setting could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FactCard id="settings-contrib" title="Who can suggest changes" className="space-y-4 px-6 py-5">
      <p className="-mt-2 text-sm text-text-2">
        Contributions land in your draft only after you accept them.
      </p>
      <RadioGroup
        aria-labelledby="settings-contrib"
        value={value}
        onValueChange={(v) => void change(v as ContributionPolicy)}
        disabled={busy}
        className="gap-2"
      >
        {POLICY_OPTIONS.map((p) => (
          <RadioCard
            key={p.value}
            id={`${legend}-${p.value}`}
            value={p.value}
            description={p.description}
          >
            {p.title}
          </RadioCard>
        ))}
      </RadioGroup>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {value === "invited" ? <Invites ns={ns} name={name} /> : null}
    </FactCard>
  );
}

function Invites({ ns, name }: { ns: string; name: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const inputId = useId();
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invites = useQuery({
    queryKey: keys.contributionInvites(ns, name),
    queryFn: () => client.contributionInvites(ns, name),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.contributionInvites(ns, name) });
  const slug = who.trim().toLowerCase();
  const valid = NAMESPACE_RE.test(slug);

  const invite = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.inviteByNamespace(ns, name, slug);
      setWho("");
      await refresh();
      toast.success(`Invited ${r.namespace}`);
    } catch (e) {
      setError(
        isApiError(e, "contribution.invite_unknown_user")
          ? `Nobody uses @${slug.replace(/^@/, "")}. Check the spelling; only people (not organisations) can be invited.`
          : writeError(e, "The invitation could not be saved. Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (user: string, label: string) => {
    setError(null);
    try {
      await client.uninvite(ns, name, user);
      await refresh();
      toast.success(`Removed ${label}`);
    } catch (e) {
      setError(writeError(e, "The invitation could not be removed. Try again."));
    }
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Invite by @namespace
        </label>
        <div className="relative min-w-0 flex-1">
          <AtSign
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3"
          />
          <Input
            id={inputId}
            value={who}
            placeholder="Invite by @namespace"
            autoComplete="off"
            spellCheck={false}
            className="pl-9 font-mono"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setWho(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={!valid || busy}>
          <UserPlus aria-hidden /> {busy ? "Inviting…" : "Invite"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {invites.isPending ? (
        <ListSkeleton rows={2} label="Loading the invitations" />
      ) : invites.isError ? (
        <p role="alert" className="text-sm text-danger">
          The invitation list could not be loaded.{" "}
          <Button variant="link" size="sm" onClick={() => void invites.refetch()}>
            Try again
          </Button>
        </p>
      ) : invites.data.items.length === 0 ? (
        <p className="text-sm text-text-2">Nobody is invited yet.</p>
      ) : (
        <ul aria-label="Invited people" className="divide-y">
          {invites.data.items.map((i) => {
            const label = i.namespace ?? "Unknown user";
            return (
              <li key={i.user} className="flex items-center gap-3 py-2">
                <Initials name={i.namespace?.replace(/^@/, "") ?? "?"} />
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      i.namespace ? "block text-sm font-medium" : "block text-sm text-text-2"
                    }
                  >
                    {label}
                  </span>
                  <span className="block text-xs text-text-3">
                    invited {formatDate(i.invited_at)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  aria-label={`Remove ${label}`}
                  onClick={() => void remove(i.user, label)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-text-3">Only you can see who's invited.</p>
    </div>
  );
}
