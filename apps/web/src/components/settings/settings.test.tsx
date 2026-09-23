import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Namespace, type PersonalToken } from "@/lib/api";
import { fakeClient, renderWithApp } from "@/test/render";
import { TokenManager } from "../token-manager";
import { RenameNamespaceDialog } from "./rename-namespace";

const TOKEN: PersonalToken = {
  id: "pat_01j00000000000000000000000",
  name: "laptop cli",
  prefix: "cp_pat_7Hq2",
  scopes: ["creations:write", "releases:publish"],
  expires_at: "2026-12-22T12:00:00.000Z",
  last_used_at: null,
  created_at: "2026-09-22T12:00:00.000Z",
};

describe("RenameNamespaceDialog", () => {
  it("renames the namespace and explains that old links keep working", async () => {
    const renameNamespace = vi.fn(
      async (_slug: string, next: string): Promise<Namespace> => ({
        slug: next,
        kind: "user",
        status: "active",
      }),
    );
    renderWithApp(<RenameNamespaceDialog current="writer" />, fakeClient({ renameNamespace }));
    await userEvent.click(await screen.findByRole("button", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { name: "Rename @writer" });
    expect(within(dialog).getByText(/keep working and redirect/)).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: /^Rename to/ });
    // 名字没有变化时不能提交。
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const input = within(dialog).getByLabelText("New name");
    await userEvent.clear(input);
    await userEvent.type(input, "Mira-Writes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename to @mira-writes" }));
    await waitFor(() => expect(renameNamespace).toHaveBeenCalledWith("writer", "mira-writes"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says why a name can't be used", async () => {
    const renameNamespace = vi.fn(async () => {
      throw new ApiError(409, "namespace.taken", "taken");
    });
    renderWithApp(<RenameNamespaceDialog current="writer" />, fakeClient({ renameNamespace }));
    await userEvent.click(await screen.findByRole("button", { name: "Rename…" }));
    const input = screen.getByLabelText("New name");
    await userEvent.clear(input);
    await userEvent.type(input, "taken");
    await userEvent.click(screen.getByRole("button", { name: "Rename to @taken" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That name is already taken.");
  });
});

describe("TokenManager", () => {
  it("shows a new token once and hides it after it is saved", async () => {
    let items: PersonalToken[] = [];
    const createToken = vi.fn(async () => {
      items = [TOKEN];
      return {
        id: TOKEN.id,
        token: `cp_pat_${"a".repeat(43)}`,
        prefix: TOKEN.prefix,
        expires_at: "2026-12-22T12:00:00.000Z",
      };
    });
    renderWithApp(<TokenManager />, fakeClient({ tokens: async () => ({ items }), createToken }));
    expect(await screen.findByText("You have no active tokens")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create a token" }));
    const form = screen.getByRole("dialog", { name: "Create a token" });
    await userEvent.type(within(form).getByLabelText("Token name"), "laptop cli");
    await userEvent.click(within(form).getByLabelText(/Publish releases/));
    await userEvent.click(within(form).getByLabelText(/For an agent/));
    await userEvent.click(within(form).getByRole("button", { name: "Create token" }));
    expect(createToken).toHaveBeenCalledWith({
      name: "laptop cli",
      scopes: ["creations:read", "releases:publish"],
      expires_in_days: 90,
      agent: true,
    });
    const created = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(created).getByText(`cp_pat_${"a".repeat(43)}`)).toBeTruthy();
    await userEvent.click(within(created).getByRole("button", { name: "I've saved it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // 明文不会再出现，列表里只剩前缀。
    expect(screen.queryByText(`cp_pat_${"a".repeat(43)}`)).toBeNull();
    expect(await screen.findByText(`${TOKEN.prefix}…`)).toBeTruthy();
  });

  it("asks before revoking a token", async () => {
    const revokeToken = vi.fn(async () => {});
    renderWithApp(
      <TokenManager />,
      fakeClient({ tokens: async () => ({ items: [TOKEN] }), revokeToken }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Revoke laptop cli" }));
    const confirm = screen.getByRole("alertdialog", { name: "Revoke laptop cli?" });
    expect(revokeToken).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(revokeToken).toHaveBeenCalledWith(TOKEN.id));
  });
});
