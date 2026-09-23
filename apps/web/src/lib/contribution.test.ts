import { mergeContribution } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildChanges, contributionBase, describeKey, needsExplicitGrant } from "./contribution";

const CREATION = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/mira",
  type: "character",
  display_name: "Mira",
  fragments: [
    {
      id: "intro",
      kind: "character",
      stable: true,
      content: { type: "text", text: "Mira keeps the lighthouse." },
    },
    {
      id: "habit",
      kind: "character",
      stable: true,
      content: { type: "text", text: "She hums while working." },
    },
  ],
  meta: {
    default_locale: "en",
    rating: "general",
    rights: "original",
    license: "CC-BY-4.0",
    tags: ["sea"],
  },
};

describe("buildChanges", () => {
  it("returns nothing when nothing was edited", () => {
    const base = contributionBase(CREATION);
    expect(buildChanges(base.canonical, base.edit)).toEqual([]);
  });

  it("produces changes that the three-way merge applies to the same base", () => {
    const base = contributionBase(CREATION);
    const edit = {
      fragments: [
        {
          ...(base.edit.fragments[0] as (typeof base.edit.fragments)[number]),
          content: { type: "text" as const, text: "Mira keeps the old lighthouse." },
        },
        {
          id: "storm",
          stable: true,
          kind: "character" as const,
          content: { type: "text" as const, text: "Storms do not scare her." },
        },
      ],
      rating: "teen" as const,
      tags: [],
    };
    const changes = buildChanges(base.canonical, edit);
    expect(changes).toHaveLength(5);
    const merge = mergeContribution(CREATION as never, changes);
    expect(merge.conflicts).toEqual([]);
    expect(merge.outcomes.every((o) => o.state === "applied")).toBe(true);
    expect(merge.sensitive_keys).toEqual(["metadata:meta.rating"]);
    const out = merge.result?.creation;
    expect(out?.fragments.map((f) => f.id).sort()).toEqual(["intro", "storm"]);
    expect(out?.meta.rating).toBe("teen");
    expect(out?.meta.tags ?? []).toEqual([]);
  });

  it("marks a concurrent edit of the same fragment as a conflict and keeps other edits", () => {
    const base = contributionBase(CREATION);
    const [intro, habit] = base.edit.fragments as [
      (typeof base.edit.fragments)[number],
      (typeof base.edit.fragments)[number],
    ];
    const changes = buildChanges(base.canonical, {
      ...base.edit,
      fragments: [
        { ...intro, content: { type: "text", text: "Changed by the contributor." } },
        habit,
      ],
    });
    const authorEdited = {
      ...CREATION,
      fragments: [
        { ...CREATION.fragments[0], content: { type: "text", text: "Changed by the author." } },
        CREATION.fragments[1],
      ],
    };
    expect(mergeContribution(authorEdited as never, changes).conflicts.map((c) => c.key)).toEqual([
      "fragment:intro",
    ]);
    const otherEdited = {
      ...CREATION,
      fragments: [
        CREATION.fragments[0],
        { ...CREATION.fragments[1], content: { type: "text", text: "Author changed this one." } },
      ],
    };
    const rebased = mergeContribution(otherEdited as never, changes);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.result?.creation.fragments.find((f) => f.id === "habit")?.content).toEqual({
      type: "text",
      text: "Author changed this one.",
    });
  });
});

describe("helpers", () => {
  it("requires an explicit grant for custom licenses", () => {
    expect(needsExplicitGrant("LicenseRef-All-Rights-Reserved")).toBe(true);
    expect(needsExplicitGrant("CC-BY-4.0")).toBe(false);
  });

  it("describes change keys", () => {
    expect(describeKey("fragment:intro")).toBe("Fragment #intro");
    expect(describeKey("metadata:meta.content_warnings")).toBe("content warnings");
  });
});
