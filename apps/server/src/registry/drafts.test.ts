import { canonicalizeCreation, checkCreation, OPEN_CREATION_TYPES } from "@char-pub/core";
import { expect, it } from "vitest";
import { initialDraft } from "./drafts.js";

it("starts new creations without injecting editor instructions as creative content", () => {
  for (const type of OPEN_CREATION_TYPES) {
    const draft = initialDraft({
      id: "cr_01j00000000000000000000000",
      ref: `@writer/${type}`,
      type,
      display_name: "New creation",
      author: { name: "Writer" },
    });
    const creation = canonicalizeCreation(draft).creation;
    expect(creation.fragments).toEqual([]);
    if (type === "scenario") {
      expect(creation.cast).toEqual([{ key: "player", who: { late: "persona" }, role: "user" }]);
      expect(checkCreation(creation).ok).toBe(true);
    }
    if (type === "relationship")
      expect(Object.keys(creation.slots ?? {})).toEqual(["first", "second"]);
  }
});
