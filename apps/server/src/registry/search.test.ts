import { describe, expect, it } from "vitest";
import { buildSearchTerms, buildSearchText, queryGrams, searchMode } from "./search.js";

describe("buildSearchTerms", () => {
  it("splits CJK text into unigrams and bigrams", () => {
    expect(buildSearchTerms("夜之城")).toEqual(["之", "之城", "城", "夜", "夜之"]);
    expect(buildSearchTerms("東京")).toEqual(["京", "東", "東京"]);
  });

  it("keeps latin words whole and lowercases them", () => {
    expect(buildSearchTerms("Night City")).toEqual(["city", "night"]);
  });

  it("handles mixed scripts without joining across them", () => {
    expect(buildSearchTerms("魔法Girl 猫")).toEqual(["girl", "法", "猫", "魔", "魔法"]);
  });

  it("normalizes full-width and compatibility characters", () => {
    expect(buildSearchTerms("ＡＢＣ　ｱｲ")).toEqual(buildSearchTerms("abc アイ"));
  });

  it("covers kana and hangul", () => {
    expect(buildSearchTerms("ねこ")).toEqual(["こ", "ね", "ねこ"]);
    expect(buildSearchTerms("고양이")).toContain("고양");
  });

  it("ignores punctuation and returns a sorted, de-duplicated list", () => {
    expect(buildSearchTerms("猫、猫！")).toEqual(["猫"]);
    expect(buildSearchTerms("")).toEqual([]);
  });
});

describe("queryGrams and searchMode", () => {
  it("uses grams for one or two characters", () => {
    expect(searchMode("猫")).toBe("grams");
    expect(searchMode("魔法")).toBe("grams");
    expect(searchMode("ab")).toBe("grams");
    expect(searchMode("夜之城")).toBe("trigram");
    expect(searchMode("night")).toBe("trigram");
  });

  it("turns short queries into grams that must all match", () => {
    expect(queryGrams("猫")).toEqual(["猫"]);
    expect(queryGrams("魔法")).toEqual(["魔法"]);
    expect(queryGrams("AB")).toEqual(["ab"]);
    expect(queryGrams("、")).toEqual([]);
  });
});

describe("buildSearchText", () => {
  it("joins every locale of the name and summary, tags and the ref", () => {
    const t = buildSearchText({
      ref: "@djj/alice",
      displayName: { en: "Alice", ja: "アリス" },
      summary: "A Courier",
      tags: ["cyberpunk"],
    });
    expect(t).toBe("@djj/alice\nalice\nアリス\na courier\ncyberpunk");
    expect(buildSearchText({ ref: "@a/b", displayName: "X", summary: null, tags: [] })).toBe(
      "@a/b\nx",
    );
  });
});
