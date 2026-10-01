import type { CollaborationInvitation, Collaborator } from "@char-pub/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ApiError, type Me } from "@/lib/api";
import { keys } from "@/lib/registry";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { CollaborationInvitations, CreationCollaborators } from "./collaboration";

const OTHER: Me = { ...ME, id: "usr_01j00000000000000000000001", namespace: "other" };
const member = (namespace = "guest", status: Collaborator["status"] = "pending"): Collaborator => ({
  user_id: `usr-${namespace}`,
  name: namespace,
  namespace,
  status,
  license: "CC-BY-4.0",
  invited_at: "2026-10-01T00:00:00.000Z",
  accepted_at: status === "active" ? "2026-10-01T00:00:00.000Z" : null,
});
const invitation = (
  status: CollaborationInvitation["status"] = "pending",
): CollaborationInvitation => ({
  creation: "cr_01j00000000000000000000001",
  ref: "@owner/private-work",
  display_name: { en: "Private work", de: "Privates Werk" },
  license: "CC-BY-4.0",
  status,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("shows pending/active licenses, invites, removes immediately and offers a new invitation", async () => {
  let items = [member("guest"), member("writer", "active")];
  const inviteCollaborator = vi.fn(async (_ns, _name, namespace: string) => {
    items = [...items.filter((item) => item.namespace !== namespace), member(namespace)];
  });
  const removeCollaborator = vi.fn(async (_ns, _name, user: string) => {
    items = items.filter((item) => item.user_id !== user);
  });
  const { queryClient } = renderWithApp(
    <CreationCollaborators ns="owner" name="private-work" />,
    fakeClient({
      me: async () => ME,
      collaborators: async () => ({ items }),
      inviteCollaborator,
      removeCollaborator,
    }),
  );
  const detailKey = [...keys.creation("owner", "private-work"), ME.id];
  const draftKey = [...keys.draft("owner", "private-work"), ME.id];
  queryClient.setQueryData(detailKey, { existing: true });
  queryClient.setQueryData(draftKey, { existing: true });
  const list = await screen.findByRole("list", { name: "Work collaborators" });
  expect(within(list).getByText("Pending — waiting for license acceptance")).toBeTruthy();
  expect(within(list).getByText("Active — can edit drafts")).toBeTruthy();
  expect(within(list).getAllByText("CC-BY-4.0")).toHaveLength(2);
  await userEvent.type(screen.getByLabelText("Invite collaborator by @namespace"), "@new-person");
  await userEvent.click(screen.getByRole("button", { name: "Invite collaborator" }));
  expect(inviteCollaborator).toHaveBeenCalledWith("owner", "private-work", "new-person");
  expect(await screen.findByText("@new-person", { selector: "p" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Remove collaborator @writer" }));
  expect(removeCollaborator).toHaveBeenCalledWith("owner", "private-work", "usr-writer");
  await waitFor(() => expect(screen.queryByText("@writer", { selector: "p" })).toBeNull());
  expect(screen.getByText(/Previously loaded content and unexpired download links/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Invite @writer again" }));
  expect(inviteCollaborator).toHaveBeenLastCalledWith("owner", "private-work", "writer");
  await waitFor(() => expect(screen.queryByText("Active — can edit drafts")).toBeNull());
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(draftKey)?.isInvalidated).toBe(true);
});

it("keeps the namespace and member list when invitation or removal fails", async () => {
  renderWithApp(
    <CreationCollaborators ns="owner" name="private-work" />,
    fakeClient({
      me: async () => ME,
      collaborators: async () => ({ items: [member()] }),
      inviteCollaborator: async () => {
        throw new ApiError(422, "collaboration.invalid_target");
      },
      removeCollaborator: async () => {
        throw new Error("offline");
      },
    }),
  );
  await screen.findByText("@guest", { selector: "p" });
  await userEvent.type(screen.getByLabelText("Invite collaborator by @namespace"), "@unknown");
  await userEvent.click(screen.getByRole("button", { name: "Invite collaborator" }));
  expect((await screen.findByRole("alert")).textContent).toContain("active personal namespace");
  expect(
    (screen.getByLabelText("Invite collaborator by @namespace") as HTMLInputElement).value,
  ).toBe("@unknown");
  await userEvent.click(screen.getByRole("button", { name: "Remove collaborator @guest" }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not be removed");
  expect(screen.getByText("@guest", { selector: "p" })).toBeTruthy();
});

it("requires explicit agreement to the displayed license, accepts, and refreshes private access", async () => {
  let item = invitation();
  const acceptCollaboration = vi.fn(async () => {
    item = invitation("active");
  });
  const { queryClient } = renderWithApp(
    <CollaborationInvitations />,
    fakeClient({
      me: async () => ({ ...ME, settings: { ...ME.settings, locale: "de" } }),
      collaborationInvitations: async () => ({ items: [item] }),
      acceptCollaboration,
    }),
  );
  const detailKey = [...keys.creation("owner", "private-work"), ME.id];
  const draftKey = [...keys.draft("owner", "private-work"), ME.id];
  queryClient.setQueryData(detailKey, {});
  queryClient.setQueryData(draftKey, {});
  expect(await screen.findByText("Privates Werk")).toBeTruthy();
  const accept = screen.getByRole("button", { name: "Accept invitation to @owner/private-work" });
  expect((accept as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(accept);
  expect(acceptCollaboration).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox", { name: /I agree.*CC-BY-4.0/ }));
  await userEvent.click(accept);
  expect(acceptCollaboration).toHaveBeenCalledWith("owner", "private-work", "CC-BY-4.0");
  expect(
    (await screen.findByRole("link", { name: "Edit @owner/private-work" })).getAttribute("href"),
  ).toBe("/c/owner/private-work/edit");
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(draftKey)?.isInvalidated).toBe(true);
});

it("clears agreement on acceptance failure", async () => {
  const item = invitation();
  renderWithApp(
    <CollaborationInvitations />,
    fakeClient({
      me: async () => ME,
      collaborationInvitations: async () => ({ items: [item] }),
      acceptCollaboration: async () => {
        throw new ApiError(409, "collaboration.license_changed");
      },
    }),
  );
  await screen.findByText("Private work");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Accept invitation to @owner/private-work" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("license changed");
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
});

it("requires fresh agreement when an invitation's license changes", async () => {
  let item = invitation();
  const { queryClient } = renderWithApp(
    <CollaborationInvitations />,
    fakeClient({
      me: async () => ME,
      collaborationInvitations: async () => ({ items: [item] }),
    }),
  );
  await screen.findByText("Private work");
  await userEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
  item = { ...item, license: "CC0-1.0" };
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["collaboration-invitations", ME.id] });
  });
  expect(
    (await screen.findByRole("checkbox", { name: /CC0-1.0/ })).getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    (
      screen.getByRole("button", {
        name: "Accept invitation to @owner/private-work",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("isolates private query responses when the account changes before they finish", async () => {
  const old = deferred<{ items: Collaborator[] }>();
  const collaborators = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue({ items: [] });
  const { queryClient } = renderWithApp(
    <CreationCollaborators ns="owner" name="private-work" />,
    fakeClient({ me: async () => ME, collaborators }),
  );
  await waitFor(() => expect(collaborators).toHaveBeenCalledTimes(1));
  await act(async () => {
    queryClient.setQueryData(keys.me, OTHER);
  });
  await waitFor(() => expect(collaborators).toHaveBeenCalledTimes(2));
  await act(async () => {
    old.resolve({ items: [member("private-old-actor")] });
    await old.promise;
  });
  expect(screen.queryByText("@private-old-actor")).toBeNull();
  expect(await screen.findByText("No collaborators yet.")).toBeTruthy();
});

it("does not show or refresh from a late invitation write under the previous account", async () => {
  const pending = deferred<void>();
  const collaborators = vi.fn(async () => ({ items: [] }));
  const inviteCollaborator = vi.fn(() => pending.promise);
  const { queryClient } = renderWithApp(
    <CreationCollaborators ns="owner" name="private-work" />,
    fakeClient({ me: async () => ME, collaborators, inviteCollaborator }),
  );
  await screen.findByText("No collaborators yet.");
  await userEvent.type(screen.getByLabelText("Invite collaborator by @namespace"), "@old-choice");
  await userEvent.click(screen.getByRole("button", { name: "Invite collaborator" }));
  await act(async () => {
    queryClient.setQueryData(keys.me, OTHER);
  });
  await waitFor(() => expect(collaborators).toHaveBeenCalledTimes(2));
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  expect(screen.queryByText(/Invitation saved for/)).toBeNull();
  expect(collaborators).toHaveBeenCalledTimes(2);
  expect(inviteCollaborator).toHaveBeenCalledTimes(1);
});

it("isolates a pending acceptance from a new account's invitations and permission cache", async () => {
  const pending = deferred<void>();
  const collaborationInvitations = vi
    .fn()
    .mockResolvedValueOnce({ items: [invitation()] })
    .mockResolvedValue({ items: [] });
  const acceptCollaboration = vi.fn(() => pending.promise);
  const { queryClient } = renderWithApp(
    <CollaborationInvitations />,
    fakeClient({ me: async () => ME, collaborationInvitations, acceptCollaboration }),
  );
  await screen.findByText("Private work");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Accept invitation to @owner/private-work" }),
  );
  const otherKey = [...keys.creation("owner", "private-work"), OTHER.id];
  queryClient.setQueryData(otherKey, { unrelated: true });
  await act(async () => {
    queryClient.setQueryData(keys.me, OTHER);
  });
  await waitFor(() => expect(collaborationInvitations).toHaveBeenCalledTimes(2));
  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
  expect(screen.queryByText("Private work")).toBeNull();
  expect(screen.queryByRole("link", { name: "Edit @owner/private-work" })).toBeNull();
  expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  expect(collaborationInvitations).toHaveBeenCalledTimes(2);
});

it("retries loading failures and never queries invitations for signed-out users", async () => {
  const collaborationInvitations = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ items: [] });
  const first = renderWithApp(
    <CollaborationInvitations />,
    fakeClient({ me: async () => ME, collaborationInvitations }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No collaboration invitations.")).toBeTruthy();
  first.unmount();
  const signedOut = vi.fn(async () => ({ items: [] }));
  renderWithApp(
    <CollaborationInvitations />,
    fakeClient({ me: async () => null, collaborationInvitations: signedOut }),
  );
  expect(await screen.findByText("Sign in to view collaboration invitations.")).toBeTruthy();
  expect(signedOut).not.toHaveBeenCalled();
});
