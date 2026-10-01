import { RuntimeLaunchRequestSchema } from "@char-pub/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTestCreation } from "@/test/build";
import { draftOrigin } from "@/test/draft-build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { RuntimeLaunch } from "./runtime-launch";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const { artifact } = buildTestCreation({
    root: {
      origin: draftOrigin,
      visibility: "private",
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/story",
        type: "scenario",
        display_name: "Story",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
        cast: [{ key: "alice", who: { late: "character" } }],
        fragments: [
          {
            id: "secret",
            stable: true,
            kind: "scenario",
            content: { type: "text", text: "PRIVATE_BODY" },
          },
        ],
        story: {
          version: 1,
          scenes: [{ id: "hall", title: "Hall" }],
          starts: [
            { id: "day", title: "Day", description: "Daylight", scene: "hall" },
            { id: "night", title: "Night", description: "Darkness", scene: "hall" },
          ],
        },
      },
    },
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  return artifact;
}

async function chooseRuntime() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start playing" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Start playing" }));
  await userEvent.type(screen.getByLabelText("Runtime launch URL"), "http://127.0.0.1:19389/");
}

it("requires an opening then opens the chosen Runtime with only exact static identifiers", async () => {
  const artifact = fixture();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderWithApp(<RuntimeLaunch artifact={artifact} />, fakeClient({ me: async () => ME }));
  await chooseRuntime();
  await userEvent.click(screen.getByRole("button", { name: "Open Runtime" }));
  expect(screen.getByRole("alert").textContent).toContain("Choose an opening");
  expect(open).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText("Opening"), "night");
  await userEvent.selectOptions(screen.getByLabelText("View"), "per-agent");
  const speaker = artifact.ir.participants.find((entry) => entry.cast_key === "alice");
  if (!speaker) throw new Error("Expected Alice instance");
  await userEvent.selectOptions(screen.getByLabelText("Speaking participant"), speaker.key);
  await userEvent.click(screen.getByRole("button", { name: "Open Runtime" }));
  expect(open).toHaveBeenCalledTimes(1);
  const call = open.mock.calls[0];
  expect(call?.slice(1)).toEqual(["_blank", "noopener,noreferrer"]);
  const url = new URL(String(call?.[0]));
  const payload = RuntimeLaunchRequestSchema.parse(
    JSON.parse(decodeURIComponent(url.hash.slice("#launch=".length))),
  );
  expect(payload.source).toEqual(artifact.root);
  expect(payload.start).toBe("night");
  expect(payload.view).toEqual({ mode: "per-agent", for_participant: speaker.key });
  expect(url.search).toBe("");
  expect(url.href).not.toContain("PRIVATE_BODY");
  expect(screen.getByRole("status").textContent).toContain(
    "authorize access and start a new session",
  );
  expect(window.localStorage.getItem(`charpub.runtime-destinations.v1:${ME.id}`)).toBe(
    JSON.stringify(["http://127.0.0.1:19389/"]),
  );
});

it("refuses a click after the draft changes and after the account cache changes before rendering", async () => {
  let current = true;
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const { queryClient } = renderWithApp(
    <RuntimeLaunch artifact={fixture()} isCurrent={() => current} />,
    fakeClient({ me: async () => ME }),
  );
  await chooseRuntime();
  await userEvent.selectOptions(screen.getByLabelText("Opening"), "day");
  current = false;
  await userEvent.click(screen.getByRole("button", { name: "Open Runtime" }));
  expect(screen.getByRole("alert").textContent).toContain("account or work changed");
  expect(open).not.toHaveBeenCalled();
  current = true;
  const button = screen.getByRole("button", { name: "Open Runtime" });
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000002" });
    button.click();
  });
  expect(open).not.toHaveBeenCalled();
});

it("does not open an expired build even if its dialog was already prepared", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderWithApp(<RuntimeLaunch artifact={fixture()} />, fakeClient({ me: async () => ME }));
  await chooseRuntime();
  await userEvent.selectOptions(screen.getByLabelText("Opening"), "day");
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(draftOrigin.expires_at));
  await act(async () => screen.getByRole("button", { name: "Open Runtime" }).click());
  expect(screen.getByRole("alert").textContent).toContain("expired");
  expect(open).not.toHaveBeenCalled();
});
