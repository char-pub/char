import { AssetSlotSchema, CreationSchema } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import type { Working } from "./draft";
import { applyDraftReapply, createDraftReapply, sameDraftValue } from "./draft-reapply";

const fragment = (id: string, text: string) => ({
  id,
  stable: true,
  kind: "knowledge" as const,
  content: { type: "text" as const, text },
});
const base = (): Working => ({
  id: "server-id",
  ref: "@author/work",
  type: "scenario",
  fragments: [fragment("first", "First"), fragment("second", "Second")],
  story: {
    version: 1,
    scenes: [{ id: "room", title: "Room" }],
    vars: { count: { type: "int", init: 0, description: "Count" } },
  },
  extra: { future: "untouched" },
});
function result(before: Working, mine: Working, latest: Working, all?: "mine" | "latest") {
  const plan = createDraftReapply(before, mine, latest);
  const choices = all ? Object.fromEntries(plan.entries.map((entry) => [entry.key, all])) : {};
  return { plan, ...applyDraftReapply(plan, choices, { mine, latest }) };
}

describe("raw draft reapplication", () => {
  it("keeps edits on different objects, unknown fields and the latest server identity", () => {
    const before = base();
    const mine = {
      ...before,
      id: "forged",
      ref: "@wrong/work",
      type: "character",
      fragments: [fragment("first", "Mine"), fragment("second", "Second")],
    };
    const latest = {
      ...before,
      id: "current-id",
      ref: "@renamed/work",
      fragments: [fragment("first", "First"), fragment("second", "Remote")],
      extra: { future: "new server value" },
    };
    const merged = result(before, mine, latest);
    expect(merged.unresolved).toEqual([]);
    expect(merged.working).toEqual({
      ...latest,
      fragments: [fragment("first", "Mine"), fragment("second", "Remote")],
    });
    expect(merged.plan.entries.map((entry) => entry.label)).toEqual(["Passage: first"]);
    expect(mine.fragments[1]?.content.text).toBe("Second");
  });

  it("requires a deliberate choice for different edits to the same object and for modify/delete", () => {
    const before = base();
    const mine = {
      ...before,
      fragments: [fragment("first", "Mine"), fragment("second", "Second")],
    };
    const latest = {
      ...before,
      fragments: [
        { ...fragment("first", "First"), description: "Remote metadata" },
        fragment("second", "Second"),
      ],
    };
    const conflict = result(before, mine, latest);
    expect(conflict.working).toBeNull();
    expect(conflict.unresolved).toHaveLength(1);
    expect(conflict.plan.entries[0]).toMatchObject({ conflict: true, defaultChoice: null });
    expect(result(before, mine, latest, "latest").working).toEqual(latest);
    expect(result(before, mine, latest, "mine").working?.fragments?.[0]).toEqual(mine.fragments[0]);
    const removed = { ...before, fragments: [fragment("second", "Second")] };
    expect(result(before, mine, removed).unresolved).toHaveLength(1);
    expect(result(before, mine, removed, "mine").working?.fragments?.map((f) => f.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("applies ordering only to surviving objects and retains remote additions", () => {
    const before = base();
    const mine = {
      ...before,
      fragments: [fragment("second", "Second"), fragment("first", "First")],
    };
    const latest = {
      ...before,
      fragments: [
        fragment("first", "First"),
        fragment("remote", "New"),
        fragment("second", "Second"),
      ],
    };
    const conflict = result(before, mine, latest);
    expect(conflict.plan.entries).toHaveLength(1);
    expect(conflict.plan.entries[0]?.kind).toBe("order");
    expect(result(before, mine, latest, "mine").working?.fragments?.map((f) => f.id)).toEqual([
      "second",
      "first",
      "remote",
    ]);
    const deleted = { ...before, fragments: [fragment("second", "Second")] };
    expect(result(before, mine, deleted, "mine").working?.fragments?.map((f) => f.id)).toEqual([
      "second",
    ]);
  });

  it("addresses Story objects/maps, cast roles, groups, Sources and complete asset slots independently", () => {
    const before: Working = {
      story: {
        version: 1,
        scenes: [{ id: "room", title: "Old" }],
        vars: { count: { type: "int", init: 0 } },
        knowing: { "#fact": { start: { knows: [] } } },
      },
      cast: [{ key: "host", part: "Old" }],
      groups: [{ id: "guide", title: "Old" }],
      sources: [{ id: "book", description: "Old" }],
    };
    const mine: Working = {
      ...before,
      story: {
        version: 1,
        scenes: [{ id: "room", title: "" }],
        vars: { count: { type: "int", init: 0 } },
        knowing: { "#fact": { start: { knows: ["host"] } } },
      },
      groups: [{ id: "guide", title: "Mine" }],
    };
    const latest: Working = {
      ...before,
      cast: [{ key: "host", part: "Remote" }],
      sources: [{ id: "book", description: "Remote" }],
    };
    const merged = result(before, mine, latest);
    expect(CreationSchema.safeParse(mine).success).toBe(false);
    expect(merged.working).toEqual({ ...latest, story: mine.story, groups: mine.groups });
    expect(merged.plan.entries.map((e) => e.label)).toEqual([
      "Scene: room",
      "Knowledge: #fact",
      "Group: guide",
    ]);
  });

  it("keeps invalid or duplicate-ID lists whole rather than guessing object identities", () => {
    const before: Working = { groups: [{ id: "one", description: "Old" }] };
    const mine: Working = { groups: [{ id: "one", description: "" }, { id: "one" }] };
    const latest: Working = { groups: [{ id: "one", description: "Remote" }] };
    const conflict = result(before, mine, latest);
    expect(conflict.plan.entries).toHaveLength(1);
    expect(conflict.plan.entries[0]).toMatchObject({
      kind: "field",
      label: "Groups",
      conflict: true,
    });
    expect(result(before, mine, latest, "mine").working).toEqual(mine);
  });

  it("keeps full author fixtures and other configuration atomic and preserves exact text bytes", () => {
    const bytes = "\uFEFF# Guide\r\ne\u0301  \r\n";
    const before: Working = {
      assembly_tests: [
        { id: "test", session: { history: [{ text: "Old" }] }, source_texts: { guide: "Old" } },
      ],
    };
    const mine: Working = {
      assembly_tests: [
        { id: "test", session: { history: [{ text: bytes }] }, source_texts: { guide: bytes } },
      ],
      bootstrap: { greetings: [{ id: "start", text: bytes }] },
    };
    const latest: Working = { ...before, display_name: "Remote name" };
    const merged = result(before, mine, latest);
    expect(merged.working).toEqual({ ...latest, ...mine });
    expect(JSON.stringify(merged.working)).toContain(JSON.stringify(bytes).slice(1, -1));
    const changedFixture = { assembly_tests: [{ id: "other" }] };
    expect(
      result(before, mine, changedFixture).plan.entries.find((e) => e.label === "Author tests"),
    ).toMatchObject({ kind: "field", conflict: true });
    expect(sameDraftValue(bytes, bytes.normalize("NFC").replaceAll("\r\n", "\n"))).toBe(false);
  });

  it("rejects a reviewed plan after local editing or another remote save, including whitespace-only edits", () => {
    const before = base();
    const mine = { ...before, display_name: "Mine\r\n" };
    const latest = { ...before, summary: "Remote" };
    const plan = createDraftReapply(before, mine, latest);
    expect(
      applyDraftReapply(plan, {}, { mine: { ...mine, display_name: "Mine\n" }, latest }),
    ).toMatchObject({ stale: true, working: null });
    expect(
      applyDraftReapply(plan, {}, { mine, latest: { ...latest, summary: "New remote" } }),
    ).toMatchObject({ stale: true, working: null });
    mine.summary = "Edited after review";
    expect(plan.mine).not.toHaveProperty("summary");
  });

  it("does not revive a deleted Story implicitly or remove remotely added objects through an order choice", () => {
    const before = base();
    const mine = { ...before, story: { version: 1, scenes: [{ id: "room", title: "Mine" }] } };
    const latest = { ...before };
    delete latest.story;
    const plan = result(before, mine, latest);
    expect(plan.plan.entries.map((e) => e.label)).toEqual(["Story"]);
    expect(plan.working).toBeNull();
    expect(result(before, mine, latest, "latest").working).not.toHaveProperty("story");
    expect(result(before, mine, latest, "mine").working?.story).toEqual(mine.story);
  });

  it("preserves explicit absent/empty fields and permits ordinary prototype-like author IDs safely", () => {
    const before: Working = { groups: [{ id: "constructor" }] };
    const mine: Working = { groups: [] };
    expect(result(before, mine, before).working?.groups).toEqual([]);
    const missing: Working = {};
    expect(result(before, missing, before).working).not.toHaveProperty("groups");
    const data = JSON.parse(
      '{"__proto__":{"safe":"own JSON field"},"story":{"vars":{"constructor":{"init":1}}}}',
    ) as Working;
    const merged = result({}, data, {}).working;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged && Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
    expect(merged).toEqual(data);
  });
});

it("does not turn independent additions/deletions into ordering conflicts", () => {
  const before = base();
  const mine = { ...before, fragments: [...(before.fragments ?? []), fragment("local", "Local")] };
  const latest = {
    ...before,
    fragments: [...(before.fragments ?? []), fragment("remote", "Remote")],
  };
  const added = result(before, mine, latest);
  expect(added.plan.entries.every((entry) => !entry.conflict)).toBe(true);
  expect(added.working?.fragments?.map((f) => f.id)).toEqual([
    "first",
    "second",
    "local",
    "remote",
  ]);
  const removed = result(before, { ...before, fragments: [fragment("second", "Second")] }, latest);
  expect(removed.plan.entries.every((entry) => !entry.conflict)).toBe(true);
  expect(removed.working?.fragments?.map((f) => f.id)).toEqual(["second", "remote"]);
});

it("preserves a remote reorder when the local change only adds a member, and requires choice for divergent shared order", () => {
  const before = {
    ...base(),
    fragments: [fragment("a", "A"), fragment("b", "B"), fragment("c", "C")],
  };
  const mine = { ...before, fragments: [...before.fragments, fragment("local", "Local")] };
  const latest = {
    ...before,
    fragments: [fragment("c", "C"), fragment("b", "B"), fragment("a", "A")],
  };
  const merged = result(before, mine, latest);
  expect(merged.working?.fragments?.map((f) => f.id)).toEqual(["c", "b", "a", "local"]);
  expect(merged.plan.entries.find((e) => e.kind === "order")).toMatchObject({
    conflict: false,
    defaultChoice: "latest",
  });
  const reordered = {
    ...before,
    fragments: [fragment("b", "B"), fragment("a", "A"), fragment("c", "C")],
  };
  expect(
    result(before, reordered, latest).plan.entries.find((e) => e.kind === "order"),
  ).toMatchObject({ conflict: true, defaultChoice: null });
});

it("treats an asset slot including its variants as one choice and retains unrelated remote slots", () => {
  const asset = (slot: string, alt: string) =>
    AssetSlotSchema.parse({
      slot,
      role: "presentation",
      variants: [
        {
          id: "default",
          media_type: "image/png",
          alt,
          blob: { digest: `sha256:${"a".repeat(64)}`, size: 1, availability: "mirrored" },
        },
      ],
    });
  const before: Working = { assets: [asset("avatar", "Old")] };
  const mine: Working = { assets: [asset("avatar", "My caption")] };
  const remoteAvatar = asset("avatar", "Old");
  remoteAvatar.variants.push({
    ...remoteAvatar.variants[0],
    id: "other",
    media_type: "image/png",
    blob: { digest: `sha256:${"b".repeat(64)}`, size: 2, availability: "mirrored" },
  });
  const latest: Working = { assets: [remoteAvatar, asset("cover", "Remote cover")] };
  const pending = result(before, mine, latest);
  expect(pending.plan.entries[0]).toMatchObject({ label: "Asset: avatar", conflict: true });
  expect(pending.working).toBeNull();
  expect(result(before, mine, latest, "mine").working?.assets).toEqual([
    asset("avatar", "My caption"),
    asset("cover", "Remote cover"),
  ]);
  expect(result(before, mine, latest, "latest").working?.assets).toEqual(latest.assets);
});
