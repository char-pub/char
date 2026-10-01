import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { isApiError, type Me } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { SignInRequired } from "./sign-in-required";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

const scopes: Record<string, string> = {
  profile: "Read your public profile",
  "creations:read": "Read private published creations and draft builds you can access",
  "drafts:write": "Create new creations or remix drafts in your namespace",
  "contributions:write": "Submit contributions as you",
  offline_access: "Keep access when you are away, until you revoke it",
};
const clientsKey = (actor: string) => ["oauth-clients", actor] as const;
const grantsKey = (actor: string) => ["oauth-grants", actor] as const;

function Account({ children }: { children: (actor: string) => ReactNode }) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading your account…</p>;
  if (me.isError) return <p role="alert">Could not check your account. Reload and try again.</p>;
  if (!me.data) return <SignInRequired what="manage app access" level={2} />;
  return <div key={me.data.id}>{children(me.data.id)}</div>;
}
function useCurrent(actor: string) {
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
  if (!current()) throw new DOMException("Account or request changed", "AbortError");
}
function Failure({ error }: { error: unknown }) {
  if (!error) return null;
  if (isApiError(error) && error.status === 401)
    return (
      <SignInRequired
        what="continue"
        level={2}
        description="Your session expired. Sign in again to continue."
      />
    );
  const message =
    isApiError(error) && error.status === 403
      ? "This action is not allowed for your current account. Use a browser session with permission."
      : isApiError(error) && error.status === 429
        ? "Too many requests. Wait a moment and try again."
        : "The request could not be completed. Check the details and try again.";
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
function ScopeList({ values }: { values: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm">
      {values.map((scope) => (
        <li key={scope}>
          {scopes[scope] ?? "Unrecognized permission"} <code className="text-xs">{scope}</code>
        </li>
      ))}
    </ul>
  );
}

export function OAuthClients() {
  return <Account>{(actor) => <ClientsSession actor={actor} />}</Account>;
}
function ClientsSession({ actor }: { actor: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const current = useCurrent(actor);
  const id = useId();
  const [name, setName] = useState("");
  const [uris, setUris] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const list = useQuery({
    queryKey: clientsKey(actor),
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      requireCurrent(current);
      const result = await client.oauthClients();
      requireCurrent(current);
      return result;
    },
  });
  const perform = async (action: () => Promise<void>) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
      if (!current()) return;
      await qc.invalidateQueries({ queryKey: clientsKey(actor) });
    } catch (cause) {
      if (current()) setError(cause);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const redirects = uris
    .split(/\r?\n/)
    .map((uri) => uri.trim())
    .filter(Boolean);
  return (
    <div className="space-y-5">
      <p className="text-sm text-text-2">
        Register a public client for Authorization Code with PKCE. No client secret is issued.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !redirects.length) return;
          void perform(async () => {
            const result = await client.registerOAuthClient({
              name: name.trim(),
              redirect_uris: redirects,
            });
            if (!current()) return;
            setName("");
            setUris("");
            setNotice(`Registered ${result.name}. Use its public client ID below.`);
          });
        }}
      >
        <label htmlFor={`${id}-name`} className="block space-y-1 text-sm">
          Client name
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={100}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-uris`} className="block space-y-1 text-sm">
          Redirect URIs — one per line
          <Textarea
            id={`${id}-uris`}
            value={uris}
            disabled={busy}
            onChange={(e) => setUris(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p className="text-xs text-text-2">
          Use exact HTTPS addresses, or HTTP loopback addresses for local clients. Wildcards,
          fragments and embedded credentials are not allowed.
        </p>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !name.trim() || !redirects.length}
        >
          Register public client
        </Button>
      </form>
      <Failure error={error ?? list.error} />
      {notice ? <p role="status">{notice}</p> : null}
      {list.isPending ? <p role="status">Loading your clients…</p> : null}
      {list.isError ? (
        <Button variant="outline" onClick={() => void list.refetch()}>
          Retry clients
        </Button>
      ) : null}
      {list.data?.items.length === 0 ? <p>You have no registered clients.</p> : null}
      <ul aria-label="Registered OAuth clients" className="space-y-3">
        {list.data?.items.map((entry) => (
          <li key={entry.client_id} className="space-y-2 rounded-lg border p-4">
            <h3 className="font-semibold">{entry.name}</h3>
            <p className="break-all font-mono text-sm">Client ID: {entry.client_id}</p>
            <ul aria-label={`Redirect URIs for ${entry.name}`} className="space-y-1 text-sm">
              {entry.redirect_uris.map((uri) => (
                <li className="break-all" key={uri}>
                  {uri}
                </li>
              ))}
            </ul>
            {removing === entry.client_id ? (
              <div className="space-y-2">
                <p>
                  Delete this client? It will no longer be available for authorization. Registering
                  again creates a new client ID.
                </p>
                <Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
                  Keep client
                </Button>{" "}
                <Button
                  variant="destructive-solid"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await client.deleteOAuthClient(entry.client_id);
                      if (current()) {
                        setRemoving(null);
                        setNotice(`Deleted ${entry.name}.`);
                      }
                    })
                  }
                >
                  Delete client permanently
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRemoving(entry.client_id)}
              >
                Delete {entry.name}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OAuthGrants() {
  return <Account>{(actor) => <GrantsSession actor={actor} />}</Account>;
}
function GrantsSession({ actor }: { actor: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const current = useCurrent(actor);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const list = useQuery({
    queryKey: grantsKey(actor),
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      requireCurrent(current);
      const result = await client.oauthGrants();
      requireCurrent(current);
      return result;
    },
  });
  const revoke = async (id: string, name: string) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await client.revokeOAuthGrant(id);
      if (!current()) return;
      await qc.invalidateQueries({ queryKey: grantsKey(actor) });
      if (current()) setNotice(`Revoked access for ${name}. It must ask you again to reconnect.`);
    } catch (cause) {
      if (current()) setError(cause);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">
        Apps act within the permissions you granted and your own access. Revoking access does not
        erase content an app already received.
      </p>
      <Failure error={error ?? list.error} />
      {notice ? <p role="status">{notice}</p> : null}
      {list.isPending ? <p role="status">Loading connected apps…</p> : null}
      {list.isError ? (
        <Button variant="outline" onClick={() => void list.refetch()}>
          Retry connected apps
        </Button>
      ) : null}
      {list.data?.items.length === 0 ? <p>You have no connected apps.</p> : null}
      <ul aria-label="Connected apps" className="space-y-3">
        {list.data?.items.map((entry) => (
          <li key={entry.client_id} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-semibold">{entry.name}</h3>
            <p className="break-all font-mono text-xs">{entry.client_id}</p>
            <ScopeList values={entry.scopes} />
            <p className="text-xs text-text-2">Authorized {entry.created_at}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void revoke(entry.client_id, entry.name)}
            >
              Revoke {entry.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OAuthConsent({
  oauthQuery,
  navigate = (uri: string) => window.location.assign(uri),
}: {
  oauthQuery: string;
  navigate?: (uri: string) => void;
}) {
  if (!oauthQuery)
    return (
      <p role="alert">
        This authorization request is missing. Return to the app and connect again.
      </p>
    );
  return (
    <Account>
      {(actor) => (
        <ConsentSession
          key={`${actor}:${oauthQuery}`}
          actor={actor}
          oauthQuery={oauthQuery}
          navigate={navigate}
        />
      )}
    </Account>
  );
}
function ConsentSession({
  actor,
  oauthQuery,
  navigate,
}: {
  actor: string;
  oauthQuery: string;
  navigate: (uri: string) => void;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const current = useCurrent(actor);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const details = useQuery({
    queryKey: ["oauth-consent", actor, oauthQuery],
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      requireCurrent(current);
      const result = await client.oauthConsent(oauthQuery);
      requireCurrent(current);
      return result;
    },
  });
  const decide = async (accept: boolean) => {
    if (pending.current || !current() || !details.data || details.isFetching) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await client.decideOAuthConsent({ oauth_query: oauthQuery, accept });
      if (!current()) return;
      // The server validates the signed request and produces both allow and denial redirects.
      navigate(response.redirect_uri);
    } catch (cause) {
      if (current()) setError(cause);
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const detail = details.data;
  return (
    <section
      aria-label="App authorization"
      className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-surface p-6"
    >
      <h1 className="text-2xl font-bold">Authorize an app</h1>
      <p>Signed in as {qc.getQueryData<Me | null>(keys.me)?.name}.</p>
      <Failure error={error ?? details.error} />
      {details.isPending ? <p role="status">Checking authorization request…</p> : null}
      {details.isError ? (
        <p>Return to the app to start a new authorization request if this one expired.</p>
      ) : null}
      {detail ? (
        <>
          <h2 className="text-xl font-semibold">{detail.client_name}</h2>
          <p className="break-all font-mono text-xs">Client ID: {detail.client_id}</p>
          <p className="text-sm">After your decision, you will return to:</p>
          <p className="break-all rounded border p-3 font-mono text-sm">{detail.redirect_uri}</p>
          <ScopeList values={detail.scopes} />
          <p className="text-sm text-text-2">
            This does not allow publishing, editing existing drafts, or changing visibility,
            licenses or ratings.
          </p>
          {detail.scopes.some((scope) => !scopes[scope]) ? (
            <p role="alert">
              This request contains an unrecognized permission. Start again from the app.
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button
              disabled={busy || details.isFetching || detail.scopes.some((scope) => !scopes[scope])}
              onClick={() => void decide(true)}
            >
              Authorize {detail.client_name}
            </Button>
            <Button
              variant="outline"
              disabled={busy || details.isFetching}
              onClick={() => void decide(false)}
            >
              Deny
            </Button>
          </div>
        </>
      ) : null}
      {busy ? <p role="status">Saving your decision…</p> : null}
    </section>
  );
}
