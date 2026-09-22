import { describe, expect, it } from "vitest";
import {
  formatCreationRef,
  isDigest,
  isFragmentId,
  isId,
  isLabel,
  isName,
  isNamespace,
  parseCreationRef,
  parseFullRef,
  parseLocalRef,
  unversioned,
} from "./ids.js";

describe("namespace", () => {
  it.each([
    ["a", true],
    ["djj", true],
    ["cyber-punk", true],
    ["a1", true],
    ["a".repeat(39), true],
    ["a".repeat(40), false],
    ["", false],
    ["-a", false],
    ["a-", false],
    ["A", false],
    ["a_b", false],
    ["爱丽丝", false],
    ["a.b", false],
  ])("%s → %s", (s, ok) => {
    expect(isNamespace(s)).toBe(ok);
  });
});

describe("name", () => {
  it.each([
    ["alice", true],
    ["night-city", true],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
    ["Alice", false],
    ["alice-", false],
    ["al ice", false],
  ])("%s → %s", (s, ok) => {
    expect(isName(s)).toBe(ok);
  });
});

describe("label", () => {
  it.each([
    ["1.0.0", true],
    ["1.2.0-beta.1+build.5", true],
    ["v2", true],
    ["x".repeat(64), true],
    ["x".repeat(65), false],
    ["", false],
    ["1.0/0", false],
    ["1 0", false],
  ])("%s → %s", (s, ok) => {
    expect(isLabel(s)).toBe(ok);
  });
});

describe("fragment id", () => {
  it.each([
    ["alice", true],
    ["lore/arasaka", true],
    ["a/b/c/d", true],
    ["a/b/c/d/e", false],
    ["lore_1/x-y", true],
    ["lore/", false],
    ["/lore", false],
    ["lore//x", false],
    ["Lore", false],
    ["_x", false],
    ["x_", false],
  ])("%s → %s", (s, ok) => {
    expect(isFragmentId(s)).toBe(ok);
  });
});

describe("creation ref", () => {
  it("parses with and without label", () => {
    expect(parseCreationRef("@djj/alice")).toEqual({ namespace: "djj", name: "alice" });
    expect(parseCreationRef("@djj/alice@1.2.0")).toEqual({
      namespace: "djj",
      name: "alice",
      label: "1.2.0",
    });
  });

  it.each([
    "djj/alice",
    "@djj",
    "@djj/",
    "@djj/alice@",
    "@djj/alice#x",
    "@DJJ/alice",
    "@djj/alice@1@2",
  ])("rejects %s", (s) => {
    expect(parseCreationRef(s)).toBeNull();
  });

  it("round-trips through format", () => {
    for (const s of ["@djj/alice", "@djj/alice@1.2.0"]) {
      const p = parseCreationRef(s);
      expect(p).not.toBeNull();
      if (p) expect(formatCreationRef(p)).toBe(s);
    }
  });

  it("strips the label", () => {
    expect(unversioned("@djj/alice@1.2.0")).toBe("@djj/alice");
    expect(unversioned("@djj/alice")).toBe("@djj/alice");
    expect(unversioned("nope")).toBeNull();
  });
});

describe("local and full refs", () => {
  it("parses local refs", () => {
    expect(parseLocalRef("#alice")).toBe("alice");
    expect(parseLocalRef("#lore/arasaka")).toBe("lore/arasaka");
    expect(parseLocalRef("alice")).toBeNull();
    expect(parseLocalRef("#")).toBeNull();
  });

  it("parses full refs", () => {
    expect(parseFullRef("@cyberpunk/night-city#lore/arasaka")).toEqual({
      namespace: "cyberpunk",
      name: "night-city",
      fragment: "lore/arasaka",
    });
    expect(parseFullRef("@djj/alice@1.0.0#description")).toEqual({
      namespace: "djj",
      name: "alice",
      label: "1.0.0",
      fragment: "description",
    });
    expect(parseFullRef("@djj/alice")).toBeNull();
    expect(parseFullRef("@djj/alice#")).toBeNull();
  });
});

describe("internal ids", () => {
  it("accepts TypeID with the right prefix", () => {
    expect(isId("creation", "cr_01h455vb4pex5vsknk084sn02q")).toBe(true);
    expect(isId("release", "rel_01h455vb4pex5vsknk084sn02q")).toBe(true);
  });

  it("rejects wrong prefix, length, alphabet or overflowing first char", () => {
    expect(isId("creation", "rel_01h455vb4pex5vsknk084sn02q")).toBe(false);
    expect(isId("creation", "cr_01h455vb4pex5vsknk084sn02")).toBe(false);
    expect(isId("creation", "cr_01h455vb4pex5vsknk084sn02u")).toBe(false);
    expect(isId("creation", "cr_81h455vb4pex5vsknk084sn02q")).toBe(false);
  });
});

describe("digest", () => {
  it("requires sha256 prefix and 64 lowercase hex", () => {
    expect(isDigest(`sha256:${"a".repeat(64)}`)).toBe(true);
    expect(isDigest(`sha256:${"A".repeat(64)}`)).toBe(false);
    expect(isDigest("a".repeat(64))).toBe(false);
    expect(isDigest(`sha256:${"a".repeat(63)}`)).toBe(false);
  });
});
