import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import { D, level0Character } from "./fixtures.js";

describe("progressive content definitions", () => {
  it("accepts three group levels and rejects a cycle or a fourth level", () => {
    const input = level0Character({
      groups: [
        { id: "one", title: "一", description: "入口", groups: ["two"] },
        { id: "two", title: "二", description: "背景", groups: ["three"] },
        { id: "three", title: "三", description: "人物", entries: ["description"] },
      ],
    });
    expect(checkCreation(canonicalizeCreation(input).creation).ok).toBe(true);
    const third = input.groups?.[2];
    if (!third) throw new Error("Missing fixture");
    third.groups = ["one"];
    expect(checkCreation(canonicalizeCreation(input).creation).ok).toBe(false);
    third.groups = ["four"];
    input.groups?.push({ id: "four", title: "四", description: "过深" });
    expect(
      checkCreation(canonicalizeCreation(input).creation).diagnostics.map((d) => d.code),
    ).toContain("check.group_depth");
  });

  it("requires a text context asset and valid source section declarations", () => {
    const input = level0Character({
      assets: [
        {
          slot: "handbook",
          role: "context",
          variants: [
            {
              id: "default",
              media_type: "text/plain",
              blob: { digest: D("b"), size: 42, availability: "mirrored" },
            },
          ],
        },
      ],
      sources: [
        {
          id: "handbook",
          title: "手册",
          description: "人物背景",
          asset: "handbook",
          format: "text",
          sections: [{ id: "intro", title: "简介", anchor: "L1-L10" }],
        },
      ],
    });
    expect(checkCreation(canonicalizeCreation(input).creation).ok).toBe(true);
    const section = input.sources?.[0]?.sections?.[0];
    if (!section) throw new Error("Missing fixture");
    section.anchor = "L10-L1";
    expect(
      checkCreation(canonicalizeCreation(input).creation).diagnostics.map((d) => d.code),
    ).toContain("check.source_anchor");
    section.anchor = "L1-L10";
    const asset = input.assets?.[0];
    if (!asset) throw new Error("Missing fixture");
    const variant = asset.variants[0];
    if (!variant) throw new Error("Missing variant");
    variant.blob = {
      ...variant.blob,
      availability: "linked",
      locator: { provider: "http", url: "https://example.com/book.txt" },
    };
    expect(
      checkCreation(canonicalizeCreation(input).creation).diagnostics.map((d) => d.code),
    ).toContain("check.source_not_mirrored");
    variant.blob = { digest: D("b"), size: 42, availability: "mirrored" };
    asset.role = "presentation";
    expect(
      checkCreation(canonicalizeCreation(input).creation).diagnostics.map((d) => d.code),
    ).toContain("check.source_asset");
  });

  it("description alone never opts a keyword fragment into model selection", () => {
    const input = level0Character();
    const fragment = input.fragments?.[0];
    if (!fragment) throw new Error("Missing fixture");
    fragment.activation = { mode: "keyword", keys: ["courier"] };
    fragment.description = "Character background";
    const canonical = canonicalizeCreation(input);
    expect(canonical.creation.fragments[0]?.selectable).toBeUndefined();
    fragment.selectable = true;
    fragment.description = undefined;
    expect(checkCreation(canonicalizeCreation(input).creation).ok).toBe(false);
  });
});
