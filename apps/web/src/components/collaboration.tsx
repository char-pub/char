import { type CollaborationInvitation, NamespaceSlugSchema } from "@char-pub/contracts";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { isApiError, type Me } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { localized, parseRef } from "@/lib/text";
import { FactCard } from "./creation-facts";
import { Button, buttonVariants } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";

const invitationsKey = (actor: string) => ["collaboration-invitations", actor] as const;
const collaboratorsKey = (ns: string, name: string, actor: string) =>
  [...keys.creation(ns, name), "collaborators", actor] as const;

function useCurrentActor(actor: string) {
  const qc = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => mounted.current && qc.getQueryData<Me | null>(keys.me)?.id === actor;
}
function requireCurrent(current: () => boolean) {
  if (!current()) throw new DOMException("Account or work changed", "AbortError");
}
async function refreshAccess(qc: QueryClient, actor: string, ns: string, name: string) {
  await Promise.all([
    qc.invalidateQueries({
      queryKey: keys.creation(ns, name),
      predicate: (query) => query.queryKey.includes(actor),
    }),
    qc.invalidateQueries({ queryKey: [...keys.draft(ns, name), actor] }),
    qc.invalidateQueries({ queryKey: invitationsKey(actor) }),
  ]);
}
function errorMessage(error: unknown, fallback: string) {
  if (isApiError(error, "collaboration.invalid_target"))
    return "Choose another active personal namespace. Check the spelling; organization namespaces cannot be invited.";
  if (isApiError(error, "collaboration.license_changed"))
    return "The license changed. Reload the invitations and review it again. If this invitation remains outdated, ask the owner to invite you again.";
  if (isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404))
    return "Your access or this invitation changed. Reload the page to check your current access.";
  if (isApiError(error) && error.status === 503)
    return "Changes are temporarily unavailable. Try again later.";
  if (isApiError(error) && error.status === 429)
    return "Too many changes in a short time. Try again later.";
  return fallback;
}

export function CreationCollaborators({ ns, name }: { ns: string; name: string }) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading your account…</p>;
  if (!me.data) return <p>Sign in to manage collaborators.</p>;
  return (
    <CollaboratorsSession
      key={`${me.data.id}:${ns}/${name}`}
      actor={me.data.id}
      ns={ns}
      name={name}
    />
  );
}

function CollaboratorsSession({ actor, ns, name }: { actor: string; ns: string; name: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const current = useCurrentActor(actor);
  const inputId = useId();
  const [namespace, setNamespace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<string | null>(null);
  const list = useQuery({
    queryKey: collaboratorsKey(ns, name, actor),
    gcTime: 0,
    queryFn: async () => {
      requireCurrent(current);
      const result = await client.collaborators(ns, name);
      requireCurrent(current);
      return result;
    },
  });
  const slug = namespace.trim().replace(/^@/, "").toLowerCase();
  const invite = async (who: string) => {
    if (busy || !current() || !NamespaceSlugSchema.safeParse(who).success) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await client.inviteCollaborator(ns, name, who);
      if (!current()) return;
      setNamespace("");
      setRemoved(null);
      await refreshAccess(qc, actor, ns, name);
      if (current())
        setNotice(`Invitation saved for @${who}. Check the list for their acceptance status.`);
    } catch (cause) {
      if (current()) setError(errorMessage(cause, "The invitation could not be saved. Try again."));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const remove = async (userId: string, label: string, who: string | null) => {
    if (busy || !current()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await client.removeCollaborator(ns, name, userId);
      if (!current()) return;
      await refreshAccess(qc, actor, ns, name);
      if (current()) {
        setRemoved(who);
        setNotice(
          `Removed ${label}. Saved edits remain. Restoring access requires a new invitation and license acceptance.`,
        );
      }
    } catch (cause) {
      if (current())
        setError(errorMessage(cause, "The collaborator could not be removed. Try again."));
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <FactCard
      id="settings-collaborators"
      title="Work collaborators"
      className="space-y-4 px-6 py-5"
    >
      <p className="text-sm text-text-2">
        Collaborators edit this work's shared draft directly after accepting its license.
        Publishing, licensing and access management stay with the owner.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void invite(slug);
        }}
      >
        <label htmlFor={inputId} className="min-w-0 flex-1 space-y-1 text-sm">
          Invite collaborator by @namespace
          <Input
            id={inputId}
            value={namespace}
            onChange={(event) => setNamespace(event.target.value)}
            placeholder="@writer"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !NamespaceSlugSchema.safeParse(slug).success}
        >
          Invite collaborator
        </Button>
      </form>
      {busy ? <p role="status">Saving collaboration changes…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {removed ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void invite(removed)}
        >
          Invite @{removed} again
        </Button>
      ) : null}
      {list.isPending ? (
        <p role="status">Loading collaborators…</p>
      ) : list.isError ? (
        <p role="alert">
          The collaborator list could not be loaded.{" "}
          <Button
            type="button"
            variant="link"
            onClick={() => {
              if (current()) void list.refetch();
            }}
          >
            Try again
          </Button>
        </p>
      ) : !list.data.items.length ? (
        <p className="text-sm text-text-2">No collaborators yet.</p>
      ) : (
        <ul aria-label="Work collaborators" className="space-y-3">
          {list.data.items.map((item) => {
            const label = item.namespace ? `@${item.namespace}` : item.name || "Collaborator";
            return (
              <li
                key={item.user_id}
                className="flex flex-wrap items-start justify-between gap-2 rounded border p-3"
              >
                <div className="space-y-1">
                  <p className="font-medium">{label}</p>
                  <p className="text-sm">
                    {item.status === "active"
                      ? "Active — can edit drafts"
                      : "Pending — waiting for license acceptance"}
                  </p>
                  <p className="break-all text-xs text-text-2">
                    Invitation license: <code>{item.license}</code>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Remove collaborator ${label}`}
                  onClick={() => void remove(item.user_id, label, item.namespace)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-text-2">
        Removal stops future authorized access. Previously loaded content and unexpired download
        links cannot be recalled. To restore access, invite the person again.
      </p>
    </FactCard>
  );
}

export function CollaborationInvitations() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading your account…</p>;
  if (!me.data) return <p>Sign in to view collaboration invitations.</p>;
  return (
    <InvitationsSession
      key={me.data.id}
      actor={me.data.id}
      locale={me.data.settings.locale ?? undefined}
    />
  );
}

function InvitationsSession({ actor, locale }: { actor: string; locale?: string | undefined }) {
  const client = useRegistry();
  const current = useCurrentActor(actor);
  const list = useQuery({
    queryKey: invitationsKey(actor),
    gcTime: 0,
    queryFn: async () => {
      requireCurrent(current);
      const result = await client.collaborationInvitations();
      requireCurrent(current);
      return result;
    },
  });
  return (
    <FactCard
      id="account-collaborations"
      title="Collaboration invitations"
      className="space-y-4 px-6 py-5"
    >
      <p className="text-sm text-text-2">
        Accepting gives you access to this work's private drafts and releases. Your edits go
        directly into its shared draft; the owner controls publication and licensing.
      </p>
      {list.isPending ? (
        <p role="status">Loading collaboration invitations…</p>
      ) : list.isError ? (
        <p role="alert">
          Invitations could not be loaded.{" "}
          <Button
            type="button"
            variant="link"
            onClick={() => {
              if (current()) void list.refetch();
            }}
          >
            Try again
          </Button>
        </p>
      ) : !list.data.items.length ? (
        <p>No collaboration invitations.</p>
      ) : (
        <ul aria-label="Your collaborations" className="space-y-3">
          {list.data.items.map((item) => (
            <Invitation
              key={`${item.creation}:${item.license}:${item.status}`}
              actor={actor}
              item={item}
              locale={locale}
            />
          ))}
        </ul>
      )}
    </FactCard>
  );
}

function Invitation({
  actor,
  item,
  locale,
}: {
  actor: string;
  item: CollaborationInvitation;
  locale?: string | undefined;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const current = useCurrentActor(actor);
  const consentId = useId();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = parseRef(item.ref);
  const accept = async () => {
    if (!agree || busy || !target || !current()) return;
    setBusy(true);
    setError("");
    try {
      await client.acceptCollaboration(target.ns, target.name, item.license);
      if (!current()) return;
      await refreshAccess(qc, actor, target.ns, target.name);
    } catch (cause) {
      if (current()) {
        setAgree(false);
        setError(
          errorMessage(cause, "The invitation could not be accepted. Review it and try again."),
        );
      }
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <li className="space-y-2 rounded border p-3">
      <p className="font-medium">{localized(item.display_name, locale)}</p>
      <p className="break-all font-mono text-xs">{item.ref}</p>
      <p className="text-sm">
        Invitation license: <code>{item.license}</code>
      </p>
      {item.status === "active" ? (
        <>
          <p className="text-sm">Active collaboration</p>
          {target ? (
            <Link
              to="/c/$ns/$name/edit"
              params={target}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit {item.ref}
            </Link>
          ) : null}
        </>
      ) : (
        <>
          <label htmlFor={consentId} className="flex items-start gap-2 text-sm">
            <Checkbox
              id={consentId}
              checked={agree}
              disabled={busy}
              onCheckedChange={(value) => setAgree(value === true)}
            />
            I agree to contribute my edits to {item.ref} under {item.license}.
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!agree || busy || !target}
            onClick={() => void accept()}
          >
            {busy ? "Accepting…" : `Accept invitation to ${item.ref}`}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
