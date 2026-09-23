import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLE_PATH, buildBundle, listCaseDirs, loadCase, serializeBundle } from "./cases.js";

describe("conformance case files", () => {
  it("runner/cases.gen.json matches the case directories (run `pnpm conformance:bundle`)", () => {
    expect(readFileSync(BUNDLE_PATH, "utf8")).toBe(serializeBundle(buildBundle()));
  });

  it("every case has consistent metadata", () => {
    for (const dir of listCaseDirs()) {
      const c = loadCase(dir);
      const m = c.meta;
      expect(m.spec_refs.length, dir).toBeGreaterThan(0);
      expect(m.expect, dir).toBeDefined();
      if (m.kind === "assembler") expect(m.expect, dir).toBe("trace");
      if (m.kind === "ccv3") expect(m.expect, dir).toBe("loss-report");
      if (m.kind === "publish") expect(c.input.registry, dir).toBeDefined();
      if (m.status === "reviewed") {
        expect(m.reviewed_by, dir).toBeTruthy();
        expect(m.reviewed_at, dir).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const file = m.expect ? c.expected[m.expect] : undefined;
        expect(file, `${dir}: reviewed case without expected output`).toBeDefined();
        if (m.expect === "context-ir") expect(m.expected_digest, dir).toMatch(/^sha256:/);
      } else {
        const hasExpected = Object.keys(c.expected).length > 0;
        expect(hasExpected, `${dir}: draft case must not ship expected output`).toBe(false);
      }
    }
  });
});
