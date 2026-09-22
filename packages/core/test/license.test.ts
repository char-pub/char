import { describe, expect, it } from "vitest";
import { isCharError } from "../src/errors.js";
import {
  ALL_RIGHTS_RESERVED,
  checkDependencyLicense,
  combineLicenseChecks,
  expressionTraits,
  isRedistributable,
  isValidLicense,
  licenseAlternatives,
  licenseTraits,
  parseLicense,
} from "../src/license.js";

describe("parseLicense", () => {
  it.each([
    "CC-BY-4.0",
    "MIT OR Apache-2.0",
    ALL_RIGHTS_RESERVED,
    "(MIT AND CC0-1.0) OR CC-BY-SA-4.0",
  ])("accepts %s", (s) => {
    expect(isValidLicense(s)).toBe(true);
  });

  it.each(["", "cc-by-4.0", "NOT-A-LICENSE", "(MIT", "MIT AND"])("rejects %s", (s) => {
    expect(isValidLicense(s)).toBe(false);
    try {
      parseLicense(s);
    } catch (e) {
      expect(isCharError(e) && e.code).toBe("license.invalid");
    }
  });
});

describe("licenseAlternatives", () => {
  it("expands AND over OR", () => {
    expect(licenseAlternatives(parseLicense("MIT AND (CC-BY-4.0 OR CC0-1.0)"))).toEqual([
      ["MIT", "CC-BY-4.0"],
      ["MIT", "CC0-1.0"],
    ]);
  });

  it("refuses expressions that expand too far", () => {
    const pair = "(MIT OR CC0-1.0)";
    const expr = Array.from({ length: 7 }, () => pair).join(" AND ");
    try {
      licenseAlternatives(parseLicense(expr));
      expect.unreachable();
    } catch (e) {
      expect(isCharError(e) && e.code).toBe("license.too_complex");
    }
  });
});

describe("licenseTraits", () => {
  it.each([
    [
      "CC0-1.0",
      {
        commercial: true,
        derivatives: true,
        shareAlike: false,
        redistributable: true,
        known: true,
      },
    ],
    [
      "CC-BY-4.0",
      {
        commercial: true,
        derivatives: true,
        shareAlike: false,
        redistributable: true,
        known: true,
      },
    ],
    [
      "CC-BY-SA-4.0",
      { commercial: true, derivatives: true, shareAlike: true, redistributable: true, known: true },
    ],
    [
      "CC-BY-NC-4.0",
      {
        commercial: false,
        derivatives: true,
        shareAlike: false,
        redistributable: true,
        known: true,
      },
    ],
    [
      "CC-BY-NC-ND-4.0",
      {
        commercial: false,
        derivatives: false,
        shareAlike: false,
        redistributable: true,
        known: true,
      },
    ],
    [
      "CC-BY-ND-4.0",
      {
        commercial: true,
        derivatives: false,
        shareAlike: false,
        redistributable: true,
        known: true,
      },
    ],
    [
      "GPL-3.0-only",
      { commercial: true, derivatives: true, shareAlike: true, redistributable: true, known: true },
    ],
    [
      ALL_RIGHTS_RESERVED,
      {
        commercial: false,
        derivatives: false,
        shareAlike: false,
        redistributable: false,
        known: true,
      },
    ],
    [
      "LicenseRef-Custom",
      {
        commercial: true,
        derivatives: true,
        shareAlike: false,
        redistributable: true,
        known: false,
      },
    ],
  ])("%s", (id, traits) => {
    expect(licenseTraits(id)).toEqual(traits);
  });

  it("combines AND by taking the strictest trait", () => {
    expect(expressionTraits("CC-BY-4.0 AND CC-BY-NC-4.0")).toEqual([
      {
        commercial: false,
        derivatives: true,
        shareAlike: false,
        redistributable: true,
        known: true,
      },
    ]);
  });
});

describe("isRedistributable", () => {
  it.each([
    ["CC-BY-4.0", {}, "pass", []],
    ["MIT OR Apache-2.0", {}, "pass", []],
    [ALL_RIGHTS_RESERVED, {}, "fail", ["license.not_redistributable"]],
    [ALL_RIGHTS_RESERVED, { same_owner: true }, "pass", []],
    ["LicenseRef-Custom", {}, "warn", ["license.unknown"]],
    [`${ALL_RIGHTS_RESERVED} OR CC-BY-4.0`, {}, "pass", []],
    [`${ALL_RIGHTS_RESERVED} AND CC-BY-4.0`, {}, "fail", ["license.not_redistributable"]],
  ] as const)("%s %j → %s", (expr, opts, verdict, reasonCodes) => {
    const r = isRedistributable(expr, opts);
    expect(r.verdict).toBe(verdict);
    expect(r.reasons.map((x) => x.code)).toEqual(reasonCodes);
  });
});

describe("checkDependencyLicense", () => {
  it.each([
    ["permissive on permissive", { dependent: "CC-BY-4.0", dependency: "CC0-1.0" }, "pass", []],
    [
      "NC dependency under a commercial license",
      { dependent: "CC-BY-4.0", dependency: "CC-BY-NC-4.0" },
      "warn",
      ["license.noncommercial_dependency"],
    ],
    [
      "NC dependency under an NC license",
      { dependent: "CC-BY-NC-4.0", dependency: "CC-BY-NC-4.0" },
      "pass",
      [],
    ],
    [
      "unmodified ND dependency",
      { dependent: "CC-BY-4.0", dependency: "CC-BY-ND-4.0" },
      "pass",
      [],
    ],
    [
      "modified ND dependency",
      { dependent: "CC-BY-4.0", dependency: "CC-BY-ND-4.0", modified: true },
      "fail",
      ["license.dependency_no_derivatives"],
    ],
    [
      "all-rights-reserved dependency from someone else",
      { dependent: "CC-BY-4.0", dependency: ALL_RIGHTS_RESERVED },
      "fail",
      ["license.dependency_not_redistributable"],
    ],
    [
      "all-rights-reserved dependency from the same owner",
      { dependent: ALL_RIGHTS_RESERVED, dependency: ALL_RIGHTS_RESERVED, same_owner: true },
      "pass",
      [],
    ],
    [
      "modified share-alike dependency under another license",
      { dependent: "CC-BY-4.0", dependency: "CC-BY-SA-4.0", modified: true },
      "warn",
      ["license.sharealike_dependency"],
    ],
    [
      "modified share-alike dependency under the same license",
      { dependent: "CC-BY-SA-4.0", dependency: "CC-BY-SA-4.0", modified: true },
      "pass",
      [],
    ],
    [
      "unknown dependency license",
      { dependent: "CC-BY-4.0", dependency: "LicenseRef-Custom" },
      "warn",
      ["license.dependency_unknown"],
    ],
    [
      "dependency offering a permissive alternative",
      { dependent: "CC-BY-4.0", dependency: "CC-BY-NC-4.0 OR CC-BY-4.0" },
      "pass",
      [],
    ],
  ] as const)("%s → %s", (_name, input, verdict, reasonCodes) => {
    const r = checkDependencyLicense(input);
    expect(r.verdict).toBe(verdict);
    expect(r.reasons.map((x) => x.code)).toEqual(reasonCodes);
  });
});

describe("combineLicenseChecks", () => {
  it("keeps every reason and takes the most severe verdict", () => {
    const r = combineLicenseChecks([
      checkDependencyLicense({ dependent: "CC-BY-4.0", dependency: "CC-BY-NC-4.0" }),
      isRedistributable(ALL_RIGHTS_RESERVED),
      isRedistributable("CC0-1.0"),
    ]);
    expect(r.verdict).toBe("fail");
    expect(r.reasons.map((x) => x.code)).toEqual([
      "license.noncommercial_dependency",
      "license.not_redistributable",
    ]);
  });

  it("passes when empty", () => {
    expect(combineLicenseChecks([])).toEqual({ verdict: "pass", reasons: [] });
  });
});
