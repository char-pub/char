import { isCharError } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import {
  containsKey,
  DEFAULT_SCAN_DEPTH,
  evaluateActivation,
  matchKeyword,
  scanWindow,
} from "../src/activation.js";
import { localizedString, lookupChain, matchLocale } from "../src/locale.js";
import { SessionSchema } from "../src/session.js";
import {
  counterForProfile,
  createTokenCounter,
  estimateCounter,
  isTokenizerName,
} from "../src/tokens.js";

describe("keyword matching", () => {
  const opts = { caseSensitive: false, wholeWord: false };

  it("is case-insensitive by default and NFC-normalizes the key", () => {
    expect(containsKey("hello ARASAKA", "arasaka", opts)).toBe(true);
    expect(containsKey("café", "café", opts)).toBe(true);
    expect(containsKey("hello", "", opts)).toBe(false);
  });

  it("respects case sensitivity", () => {
    expect(containsKey("ncpd", "NCPD", { ...opts, caseSensitive: true })).toBe(false);
    expect(containsKey("NCPD", "NCPD", { ...opts, caseSensitive: true })).toBe(true);
  });

  it("whole word checks boundaries on both sides and keeps searching after a partial hit", () => {
    const w = { ...opts, wholeWord: true };
    expect(containsKey("artist art", "art", w)).toBe(true);
    expect(containsKey("smart", "art", w)).toBe(false);
    expect(containsKey("art.", "art", w)).toBe(true);
    expect(containsKey("東京タワー", "東京", w)).toBe(false);
    expect(containsKey("東京タワー", "東京", opts)).toBe(true);
  });

  it("scan window takes the last N messages in order", () => {
    const h = [
      { role: "user" as const, text: "a" },
      { role: "assistant" as const, text: "b" },
      { role: "user" as const, text: "c" },
    ];
    expect(scanWindow(h, 2)).toBe("b\nc");
    expect(scanWindow(h, 10)).toBe("a\nb\nc");
    expect(DEFAULT_SCAN_DEPTH).toBe(2);
  });

  it("secondary keys with logic any need at least one hit", () => {
    const a = { mode: "keyword" as const, keys: ["gun"], secondary: ["red", "blue"] };
    expect(matchKeyword(a, [{ role: "user", text: "gun blue" }])).toBe("gun");
    expect(matchKeyword(a, [{ role: "user", text: "gun green" }])).toBeNull();
  });

  it("pinned overrides any activation mode", () => {
    expect(evaluateActivation({ mode: "manual" }, true, false, [])).toEqual({
      active: true,
      reason: "pinned",
    });
  });
});

describe("locale lookup", () => {
  it("builds the BCP 47 lookup chain and skips singleton extensions", () => {
    expect(lookupChain("zh-Hant-TW")).toEqual(["zh-Hant-TW", "zh-Hant", "zh"]);
    expect(lookupChain("en-a-bbb-x-y")).toEqual(["en-a-bbb-x-y", "en-a-bbb", "en"]);
  });

  it("matches case-insensitively and returns the available spelling", () => {
    expect(matchLocale(["ja", "zh-Hant"], "ZH-hant-tw")).toBe("zh-Hant");
    expect(matchLocale(["ja"], "fr")).toBeNull();
  });

  it("picks localized strings with fallback to the default and then a stable first key", () => {
    expect(localizedString("Alice", "ja", "en")).toBe("Alice");
    expect(localizedString({ en: "Alice", ja: "アリス" }, "ja", "en")).toBe("アリス");
    expect(localizedString({ en: "Alice", ja: "アリス" }, "fr", "en")).toBe("Alice");
    expect(localizedString({ ja: "アリス", de: "Alicia" }, "fr", "en")).toBe("Alicia");
  });
});

describe("session schema", () => {
  it("fills defaults", () => {
    expect(SessionSchema.parse({})).toEqual({ bindings: {}, history: [] });
  });

  it("requires a real persona object, not just a name", () => {
    expect(SessionSchema.safeParse({ bindings: { user: "Kai" } }).success).toBe(false);
  });
});

describe("token counters", () => {
  it("estimate counter is marked as an estimate", () => {
    expect(estimateCounter.estimated).toBe(true);
    expect(estimateCounter.count("")).toBe(0);
    expect(estimateCounter.count("hello world, this is Alice.")).toBeGreaterThan(0);
  });

  it("loads exact encodings on demand", async () => {
    const o200k = await createTokenCounter("o200k_base");
    expect(o200k.tokenizer).toBe("o200k_base");
    expect(o200k.estimated).toBe(false);
    expect(o200k.count("hello world")).toBe(2);
    const cl100k = await createTokenCounter("cl100k_base");
    expect(cl100k.count("hello world")).toBe(2);
    // 作者文本里的控制 token 字面量按普通文字计数，而不是报错。
    expect(cl100k.count("a <|endoftext|> b")).toBeGreaterThan(3);
    expect(await createTokenCounter("estimate")).toBe(estimateCounter);
  });

  it("rejects unknown tokenizer names", async () => {
    await expect(createTokenCounter("llama3")).rejects.toSatisfy(
      (e: unknown) => isCharError(e) && e.code === "tokenizer.unsupported",
    );
  });

  it("profile selection falls back to the estimate for unknown names", async () => {
    expect(isTokenizerName("o200k_base")).toBe(true);
    expect(isTokenizerName("llama3")).toBe(false);
    expect(await counterForProfile({ tokenizer: "llama3" })).toBe(estimateCounter);
    expect((await counterForProfile({ tokenizer: "cl100k_base" })).tokenizer).toBe("cl100k_base");
  });
});
