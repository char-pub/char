import { describe, expect, it } from "vitest";
import { digestExactJSON, digestOf, jcs, sha256Hex } from "../src/canonical.js";

describe("exact JSON identity", () => {
  it.each([
    ["First\r\nSecond", "First\nSecond"],
    ["Cafe\u0301", "Café"],
    ["Keep \t", "Keep"],
  ])("preserves raw strings through nested objects and arrays", (original, changed) => {
    const a = { nested: [{ text: original }] },
      b = { nested: [{ text: changed }] };
    expect(digestOf(a)).toBe(digestOf(b));
    expect(digestExactJSON(a)).not.toBe(digestExactJSON(b));
    expect(digestExactJSON(a)).toBe(`sha256:${sha256Hex(jcs(a))}`);
  });

  it("preserves dictionary keys and own prototype-like keys without prototype mutation", () => {
    const value = JSON.parse('{"é":"one","é":"two","__proto__":{"safe":true}}');
    expect(digestExactJSON(value)).toBe(`sha256:${sha256Hex(jcs(value))}`);
    expect(digestExactJSON({ "e\u0301": "x" })).not.toBe(digestExactJSON({ é: "x" }));
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("safe");
    expect(() => digestOf(value)).toThrowError(
      expect.objectContaining({ code: "canonical.duplicate_key" }),
    );
  });

  it("keeps JSON key-order and omitted optional-property equivalence without normalizing prose", () => {
    const a = { b: [0, "Raw \r\n"], a: { x: true, absent: undefined } };
    const b = { a: { x: true }, b: [-0, "Raw \r\n"] };
    expect(digestExactJSON(a)).toBe(digestExactJSON(b));
    expect(digestExactJSON({ a: "Canonical", b: 1 })).toBe(digestOf({ b: 1, a: "Canonical" }));
  });

  it.each([NaN, Infinity, new Date(), new Map(), { f: () => 1 }, [undefined]])(
    "rejects non-JSON values instead of silently erasing them",
    (value) => {
      expect(() => digestExactJSON(value)).toThrow();
    },
  );
});
