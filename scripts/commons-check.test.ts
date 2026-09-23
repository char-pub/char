/**
 * `@commons` 种子内容必须一直能通过发布校验：改了内容或改了校验规则，单元测试都会发现。
 * 也确认 REVIEW.md 里记录的 digest 与当前内容一致，避免审阅的是旧版本。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCommons } from "./commons-check.js";

const REVIEW = fileURLToPath(new URL("../content/commons/REVIEW.md", import.meta.url));

describe("@commons seed content", () => {
  it("passes the publish checks and the seed-content policy", async () => {
    const results = await checkCommons();
    const failures = results.filter((r) => !r.ok).map((r) => `${r.ref}: ${r.issues.join("; ")}`);
    expect(failures).toEqual([]);
    const byType = (t: string) => results.filter((r) => r.type === t);
    expect(byType("world").length).toBeGreaterThanOrEqual(12);
    expect(byType("lorebook").length).toBeGreaterThanOrEqual(12);
    expect(byType("character").length).toBeGreaterThanOrEqual(1);
    for (const w of byType("world")) expect(w.fragments, w.ref).toBeGreaterThanOrEqual(4);
    for (const l of byType("lorebook")) expect(l.keyword, l.ref).toBeGreaterThanOrEqual(8);
  });

  it("is reviewed against the current digests", async () => {
    const review = await readFile(REVIEW, "utf8");
    for (const r of await checkCommons()) {
      expect(review, `${r.ref} digest in REVIEW.md`).toContain(`\`${r.semantic_digest}\``);
    }
  });
});
