import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Working } from "@/lib/draft";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { AuthorTestsEditor } from "./assembly-editor";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@char-pub/assembler", async (original) => ({
  ...(await original<typeof import("@char-pub/assembler")>()),
  runAssemblyTests: run,
}));

function Harness() {
  const [working, setWorking] = useState<Working>({
    id: "cr_01j00000000000000000000000",
    ref: "@writer/scene",
    type: "scenario",
    display_name: "Scene",
    cast: [{ key: "player", who: { late: "persona" } }],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  });
  return (
    <>
      <button
        type="button"
        onClick={() => setWorking((w) => ({ ...w, display_name: `${String(w.display_name)}!` }))}
      >
        Edit creation
      </button>
      <AuthorTestsEditor working={working} update={setWorking} />
    </>
  );
}

describe("author test editor", () => {
  it("rejects malformed synthetic sessions without replacing the working session", async () => {
    renderWithApp(<Harness />, fakeClient({ me: async () => ME }));
    await userEvent.click(await screen.findByRole("button", { name: "Add author test" }));
    await userEvent.click(screen.getByText("Advanced synthetic Session JSON"));
    const json = screen.getByLabelText("Synthetic session JSON");
    await userEvent.clear(json);
    await userEvent.type(json, "[[]", { skipClick: true });
    await userEvent.click(screen.getByRole("button", { name: "Apply session JSON" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid input");
    expect(
      (screen.getByLabelText("Synthetic conversation") as HTMLTextAreaElement).value,
    ).toContain("A synthetic example.");
  });
  it("discards completed and in-flight results as soon as the creation changes", async () => {
    let finish: ((value: unknown) => void) | undefined;
    run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWithApp(<Harness />, fakeClient({ me: async () => ME }));
    await userEvent.click(await screen.findByRole("button", { name: "Add author test" }));
    await userEvent.click(screen.getByRole("button", { name: "Run author tests" }));
    await waitFor(() => expect(finish).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "Edit creation" }));
    const result = { ok: true, results: [{ id: "example", ok: true, issues: [] }] };
    finish?.(result);
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Author test results" })).toBeNull(),
    );
    run.mockResolvedValueOnce(result);
    await userEvent.click(screen.getByRole("button", { name: "Run author tests" }));
    expect(
      (await screen.findByRole("list", { name: "Author test results" })).textContent,
    ).toContain("Passed");
    await userEvent.click(screen.getByRole("button", { name: "Edit creation" }));
    expect(screen.queryByRole("list", { name: "Author test results" })).toBeNull();
  });
});
