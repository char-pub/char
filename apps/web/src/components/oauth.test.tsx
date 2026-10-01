import type { OAuthConsentDetails, OAuthGrant } from "@char-pub/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { keys } from "@/lib/registry";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { OAuthClients, OAuthConsent, OAuthGrants } from "./oauth";

const APP = {
  client_id: "client_public",
  name: "Lantern Runtime",
  redirect_uris: ["https://runtime.example/callback"],
  created_at: "2026-10-01T00:00:00Z",
};
const DETAIL: OAuthConsentDetails = {
  client_id: APP.client_id,
  client_name: APP.name,
  redirect_uri: "https://runtime.example/callback",
  scopes: ["profile", "drafts:write", "offline_access"],
};
const SIGNED = "client_id=untrusted&scope=releases%3Apublish&ba_param=one&ba_param=two&sig=signed";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("registers a public client, preserves exact redirect strings and confirms deletion", async () => {
  let items: (typeof APP)[] = [];
  const registerOAuthClient = vi.fn(async () => {
    items = [APP];
    return APP;
  });
  const deleteOAuthClient = vi.fn(async () => {
    items = [];
  });
  renderWithApp(
    <OAuthClients />,
    fakeClient({
      me: async () => ME,
      oauthClients: async () => ({ items }),
      registerOAuthClient,
      deleteOAuthClient,
    }),
  );
  await userEvent.type(await screen.findByLabelText("Client name"), APP.name);
  await userEvent.type(
    screen.getByLabelText(/Redirect URIs —/),
    "https://runtime.example/callback\nhttp://127.0.0.1:8765/callback",
  );
  await userEvent.click(screen.getByRole("button", { name: "Register public client" }));
  await waitFor(() =>
    expect(registerOAuthClient).toHaveBeenCalledWith({
      name: APP.name,
      redirect_uris: ["https://runtime.example/callback", "http://127.0.0.1:8765/callback"],
    }),
  );
  expect(await screen.findByText(`Client ID: ${APP.client_id}`)).toBeTruthy();
  expect(screen.getByText(/No client secret is issued/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: `Delete ${APP.name}` }));
  expect(deleteOAuthClient).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete client permanently" }));
  await waitFor(() => expect(deleteOAuthClient).toHaveBeenCalledWith(APP.client_id));
  expect(await screen.findByText("You have no registered clients.")).toBeTruthy();
});

it("keeps registration inputs when the server refuses the action", async () => {
  renderWithApp(
    <OAuthClients />,
    fakeClient({
      me: async () => ME,
      oauthClients: async () => ({ items: [] }),
      registerOAuthClient: async () => {
        throw new ApiError(403, "auth.forbidden", "forbidden");
      },
    }),
  );
  await userEvent.type(await screen.findByLabelText("Client name"), "My client");
  await userEvent.type(screen.getByLabelText(/Redirect URIs —/), "https://example.test/callback");
  await userEvent.click(screen.getByRole("button", { name: "Register public client" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not allowed");
  expect((screen.getByLabelText("Client name") as HTMLInputElement).value).toBe("My client");
});

it("revokes the actual client grant and explains that already received content remains", async () => {
  let items: OAuthGrant[] = [
    {
      client_id: APP.client_id,
      name: APP.name,
      scopes: ["creations:read"],
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  const revokeOAuthGrant = vi.fn(async () => {
    items = [];
  });
  renderWithApp(
    <OAuthGrants />,
    fakeClient({ me: async () => ME, oauthGrants: async () => ({ items }), revokeOAuthGrant }),
  );
  await userEvent.click(await screen.findByRole("button", { name: `Revoke ${APP.name}` }));
  await waitFor(() => expect(revokeOAuthGrant).toHaveBeenCalledWith(APP.client_id));
  expect(await screen.findByText("You have no connected apps.")).toBeTruthy();
  expect(screen.getByText(/does not erase content an app already received/)).toBeTruthy();
});

it.each([true, false])(
  "uses server-validated details and continuation for consent accept=%s",
  async (accept) => {
    const oauthConsent = vi.fn(async () => DETAIL);
    const decideOAuthConsent = vi.fn(async () => ({
      redirect_uri: "https://runtime.example/callback?verified=1",
    }));
    const navigate = vi.fn();
    renderWithApp(
      <OAuthConsent oauthQuery={SIGNED} navigate={navigate} />,
      fakeClient({ me: async () => ME, oauthConsent, decideOAuthConsent }),
    );
    expect(await screen.findByRole("heading", { name: APP.name })).toBeTruthy();
    expect(oauthConsent).toHaveBeenCalledWith(SIGNED);
    expect(screen.queryByText("releases:publish")).toBeNull();
    expect(screen.getByText("offline_access")).toBeTruthy();
    expect(screen.getByText(/Create new creations or remix drafts/)).toBeTruthy();
    expect(decideOAuthConsent).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: accept ? `Authorize ${APP.name}` : "Deny" }),
    );
    await waitFor(() =>
      expect(decideOAuthConsent).toHaveBeenCalledWith({ oauth_query: SIGNED, accept }),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://runtime.example/callback?verified=1");
  },
);

it("does not navigate on an expired decision and asks for sign-in on 401", async () => {
  const navigate = vi.fn();
  renderWithApp(
    <OAuthConsent oauthQuery={SIGNED} navigate={navigate} />,
    fakeClient({
      me: async () => ME,
      oauthConsent: async () => DETAIL,
      decideOAuthConsent: async () => {
        throw new ApiError(401, "auth.required", "required");
      },
    }),
  );
  await userEvent.click(await screen.findByRole("button", { name: `Authorize ${APP.name}` }));
  expect(await screen.findByText("Your session expired. Sign in again to continue.")).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

it("ignores a previous actor's pending registration and clears their local form", async () => {
  const pending = deferred<typeof APP>();
  const registerOAuthClient = vi.fn(() => pending.promise);
  const { queryClient } = renderWithApp(
    <OAuthClients />,
    fakeClient({
      me: async () => ME,
      oauthClients: async () => ({ items: [] }),
      registerOAuthClient,
    }),
  );
  await userEvent.type(await screen.findByLabelText("Client name"), "Private old name");
  await userEvent.type(
    screen.getByLabelText(/Redirect URIs —/),
    "https://private.example/callback",
  );
  await userEvent.click(screen.getByRole("button", { name: "Register public client" }));
  act(() => queryClient.setQueryData(keys.me, { ...ME, id: "usr_other", name: "Other writer" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Client name") as HTMLInputElement).value).toBe(""),
  );
  await act(async () => pending.resolve(APP));
  expect(screen.queryByText(/Registered Lantern Runtime/)).toBeNull();
  expect(screen.queryByText(APP.client_id)).toBeNull();
});

it("does not follow a decision made by a previous actor after an account switch", async () => {
  const pending = deferred<{ redirect_uri: string }>();
  const navigate = vi.fn();
  const { queryClient } = renderWithApp(
    <OAuthConsent oauthQuery={SIGNED} navigate={navigate} />,
    fakeClient({
      me: async () => ME,
      oauthConsent: async () => DETAIL,
      decideOAuthConsent: () => pending.promise,
    }),
  );
  await userEvent.click(await screen.findByRole("button", { name: `Authorize ${APP.name}` }));
  act(() => queryClient.setQueryData(keys.me, { ...ME, id: "usr_other", name: "Other writer" }));
  await act(async () => pending.resolve({ redirect_uri: "https://old.example/callback" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(await screen.findByText("Signed in as Other writer.")).toBeTruthy();
});

it("ignores late details from a different authorization request", async () => {
  const old = deferred<typeof DETAIL>();
  const oauthConsent = vi.fn((query: string) =>
    query === "old-signed-request"
      ? old.promise
      : Promise.resolve({ ...DETAIL, client_name: "Current Runtime" }),
  );
  function Requests() {
    const [query, setQuery] = useState("old-signed-request");
    return (
      <>
        <button type="button" onClick={() => setQuery("new-signed-request")}>
          Change request
        </button>
        <OAuthConsent oauthQuery={query} />
      </>
    );
  }
  renderWithApp(<Requests />, fakeClient({ me: async () => ME, oauthConsent }));
  await waitFor(() => expect(oauthConsent).toHaveBeenCalledWith("old-signed-request"));
  await userEvent.click(screen.getByRole("button", { name: "Change request" }));
  expect(await screen.findByRole("heading", { name: "Current Runtime" })).toBeTruthy();
  await act(async () => old.resolve(DETAIL));
  expect(screen.queryByRole("heading", { name: APP.name })).toBeNull();
  expect(screen.getByRole("button", { name: "Authorize Current Runtime" })).toBeTruthy();
});

it("rejects invalid consent details and never treats raw query parameters as a redirect", async () => {
  const navigate = vi.fn();
  renderWithApp(
    <OAuthConsent oauthQuery="redirect_uri=javascript%3Aalert(1)" navigate={navigate} />,
    fakeClient({
      me: async () => ME,
      oauthConsent: async () => {
        throw new ApiError(400, "oauth.invalid_request", "Invalid query");
      },
    }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("button", { name: `Authorize ${APP.name}` })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.queryByText(/javascript:/)).toBeNull();
});
