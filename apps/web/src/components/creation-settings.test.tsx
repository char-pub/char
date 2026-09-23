import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type SourceBinding } from "@/lib/api";
import { fakeClient, renderWithApp } from "@/test/render";
import { ContributionPolicySettings } from "./creation-settings";
import { SourceBindingSettings } from "./source-binding";

const BINDING: SourceBinding = {
  repository_id: "1",
  repository_owner_id: "2",
  installation_id: "3",
  full_name: "djj/alice-character",
  path: "char.yaml",
  tracked_ref: "refs/heads/main",
  publish_refs: ["refs/tags/*"],
  status: "active",
};

describe("ContributionPolicySettings", () => {
  it("saves the policy as soon as it is picked and manages invitations by @namespace", async () => {
    const setContributionPolicy = vi.fn().mockResolvedValue(undefined);
    let invited = [
      {
        user: "usr_01j00000000000000000000009",
        namespace: "@mika",
        invited_at: "2026-09-20T00:00:00.000Z",
      },
    ];
    const inviteByNamespace = vi.fn().mockImplementation(async (_ns, _name, who: string) => {
      invited = [
        ...invited,
        {
          user: "usr_01j0000000000000000000000a",
          namespace: `@${who.replace(/^@/, "")}`,
          invited_at: "2026-09-23T00:00:00.000Z",
        },
      ];
      return {
        user: "usr_01j0000000000000000000000a",
        namespace: `@${who.replace(/^@/, "")}`,
        invited: true,
      };
    });
    const uninvite = vi.fn().mockImplementation(async (_ns, _name, user: string) => {
      invited = invited.filter((i) => i.user !== user);
    });
    renderWithApp(
      <ContributionPolicySettings ns="djj" name="alice" policy="signed-in" />,
      fakeClient({
        setContributionPolicy,
        contributionInvites: async () => ({ items: invited }),
        inviteByNamespace,
        uninvite,
      }),
    );
    const card = await screen.findByRole("region", { name: "Who can suggest changes" });
    expect(
      within(card).getByRole("radio", { name: "Signed-in users" }).getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.click(within(card).getByLabelText("Invited people"));
    await waitFor(() =>
      expect(setContributionPolicy).toHaveBeenCalledWith("djj", "alice", "invited"),
    );

    const list = await within(card).findByRole("list", { name: "Invited people" });
    expect(within(list).getByText("@mika")).toBeTruthy();

    await userEvent.type(within(card).getByLabelText("Invite by @namespace"), "@vee");
    await userEvent.click(within(card).getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(inviteByNamespace).toHaveBeenCalledWith("djj", "alice", "@vee"));
    expect(await within(card).findByText("@vee")).toBeTruthy();

    await userEvent.click(within(card).getByRole("button", { name: "Remove @mika" }));
    await waitFor(() =>
      expect(uninvite).toHaveBeenCalledWith("djj", "alice", "usr_01j00000000000000000000009"),
    );
    await waitFor(() => expect(within(card).queryByText("@mika")).toBeNull());
  });

  it("explains an unknown namespace and puts the policy back when saving fails", async () => {
    renderWithApp(
      <ContributionPolicySettings ns="djj" name="alice" policy="invited" />,
      fakeClient({
        setContributionPolicy: () => Promise.reject(new ApiError(503, "feature.read_only")),
        contributionInvites: async () => ({
          items: [
            {
              user: "usr_01j00000000000000000000009",
              namespace: null,
              invited_at: "2026-09-20T00:00:00.000Z",
            },
          ],
        }),
        inviteByNamespace: () =>
          Promise.reject(new ApiError(422, "contribution.invite_unknown_user")),
      }),
    );
    const card = await screen.findByRole("region", { name: "Who can suggest changes" });
    // 没有 namespace 的人显示中性的文案。
    expect(await within(card).findByText("Unknown user")).toBeTruthy();
    await userEvent.type(within(card).getByLabelText("Invite by @namespace"), "nobody");
    await userEvent.click(within(card).getByRole("button", { name: "Invite" }));
    expect((await within(card).findByRole("alert")).textContent).toContain("Nobody uses @nobody");

    await userEvent.click(within(card).getByLabelText("Nobody"));
    await waitFor(() =>
      expect(
        within(card).getByRole("radio", { name: "Invited people" }).getAttribute("aria-checked"),
      ).toBe("true"),
    );
    expect(
      within(card)
        .getAllByRole("alert")
        .some((a) => a.textContent?.includes("read-only")),
    ).toBe(true);
  });
});

describe("SourceBindingSettings", () => {
  it("only explains GitHub publishing when nothing is bound", async () => {
    renderWithApp(
      <SourceBindingSettings ns="djj" name="alice" />,
      fakeClient({ sourceBinding: async () => null }),
    );
    const card = await screen.findByRole("region", { name: "Publish from GitHub" });
    expect(await within(card).findByText(/char.pub GitHub App/)).toBeTruthy();
    expect(within(card).queryByRole("textbox")).toBeNull();
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("shows why a frozen binding is paused and lets the owner keep the repository", async () => {
    const resolveSourceBinding = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, "github.repository_not_accessible"));
    renderWithApp(
      <SourceBindingSettings ns="djj" name="alice" />,
      fakeClient({
        sourceBinding: async () => ({
          ...BINDING,
          status: "frozen",
          frozen_reason: "The repository moved to a new owner.",
        }),
        resolveSourceBinding,
      }),
    );
    const card = await screen.findByRole("region", { name: "Publish from GitHub" });
    expect(await within(card).findByText("Paused")).toBeTruthy();
    expect(within(card).getByText("The repository moved to a new owner.")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Keep this repository" }));
    await waitFor(() =>
      expect(resolveSourceBinding).toHaveBeenCalledWith("djj", "alice", "rebind"),
    );
    expect((await within(card).findByRole("alert")).textContent).toMatch(/Unbind it instead/);
  });

  it("asks for confirmation before unbinding an active repository", async () => {
    const unbindSource = vi.fn().mockResolvedValue(undefined);
    let bound = true;
    renderWithApp(
      <SourceBindingSettings ns="djj" name="alice" />,
      fakeClient({
        sourceBinding: async () => (bound ? BINDING : null),
        unbindSource: async (...args) => {
          bound = false;
          return unbindSource(...args);
        },
      }),
    );
    const card = await screen.findByRole("region", { name: "Publish from GitHub" });
    await userEvent.click(await within(card).findByRole("button", { name: "Unbind" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Unbind djj/alice-character?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Unbind" }));
    await waitFor(() => expect(unbindSource).toHaveBeenCalledWith("djj", "alice"));
    expect(await within(card).findByText(/No repository is connected/)).toBeTruthy();
  });
});
