import { describe, expect, it } from "vitest";
import {
  CAST_KEY_RE,
  formatCreationRef,
  isDigest,
  isFragmentId,
  isId,
  isLabel,
  isName,
  isNamespace,
  PARAM_NAME_RE,
  parseCreationRef,
  parseFullRef,
  parseLocalRef,
  SEGMENT_RE,
  SLOT_NAME_RE,
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

describe("length limits", () => {
  const seg64 = "a".repeat(64);
  const seg65 = "a".repeat(65);

  it.each([
    [seg64, true],
    [seg65, false],
    [`a${"_".repeat(62)}a`, true],
    [`a${"-".repeat(63)}a`, false],
    ["0", true],
  ])("fragment id segment case %#", (s, ok) => {
    expect(SEGMENT_RE.test(s)).toBe(ok);
    expect(isFragmentId(s)).toBe(ok);
  });

  it("accepts four segments of the maximum length", () => {
    expect(isFragmentId([seg64, seg64, seg64, seg64].join("/"))).toBe(true);
  });

  it.each([0, 1, 2, 3])("rejects a 65-character segment at position %i", (pos) => {
    const segs = [seg64, seg64, seg64, seg64];
    segs[pos] = seg65;
    expect(isFragmentId(segs.join("/"))).toBe(false);
  });

  it("applies the same limits inside local and full refs", () => {
    expect(parseLocalRef(`#${seg64}`)).toBe(seg64);
    expect(parseLocalRef(`#${seg65}`)).toBeNull();

    const ns = "n".repeat(39);
    const name = "m".repeat(64);
    const label = "1".repeat(64);
    const frag = [seg64, seg64, seg64, seg64].join("/");
    expect(parseFullRef(`@${ns}/${name}@${label}#${frag}`)).toEqual({
      namespace: ns,
      name,
      label,
      fragment: frag,
    });
    expect(parseFullRef(`@${ns}n/${name}@${label}#${frag}`)).toBeNull();
    expect(parseFullRef(`@${ns}/${name}m@${label}#${frag}`)).toBeNull();
    expect(parseFullRef(`@${ns}/${name}@${label}1#${frag}`)).toBeNull();
    expect(parseFullRef(`@${ns}/${name}@${label}#${frag}/a`)).toBeNull();
    expect(parseFullRef(`@${ns}/${name}@${label}#${seg65}`)).toBeNull();
  });

  it("applies the namespace, name and label limits inside creation refs", () => {
    const longest = `@${"n".repeat(39)}/${"m".repeat(64)}@${"1".repeat(64)}`;
    expect(parseCreationRef(longest)).not.toBeNull();
    expect(parseCreationRef(`@${"n".repeat(40)}/alice`)).toBeNull();
    expect(parseCreationRef(`@djj/${"m".repeat(65)}`)).toBeNull();
    expect(parseCreationRef(`@djj/alice@${"1".repeat(65)}`)).toBeNull();
  });

  it.each([
    ["slot name", SLOT_NAME_RE],
    ["param name", PARAM_NAME_RE],
    ["cast key", CAST_KEY_RE],
  ])("%s allows at most 32 characters and must start with a letter", (_kind, re) => {
    expect(re.test(`a${"b".repeat(31)}`)).toBe(true);
    expect(re.test(`a${"b".repeat(32)}`)).toBe(false);
    expect(re.test("1a")).toBe(false);
  });
});
