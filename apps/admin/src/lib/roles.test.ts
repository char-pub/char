import { describe, expect, it } from "vitest";
import { EXPECTED_CAPABILITIES } from "@/test/role-matrix";
import { STAFF_ROLES } from "./api";
import { capabilitiesOf, parseRoles, ROLE_CAPABILITIES, STAFF_CAPABILITIES } from "./roles";

describe("staff role matrix", () => {
  it.each(STAFF_ROLES)("%s has exactly the documented capabilities", (role) => {
    expect(new Set(capabilitiesOf([role]))).toEqual(new Set(EXPECTED_CAPABILITIES[role]));
  });

  it("owner has every capability and the table does not list owner separately", () => {
    expect(capabilitiesOf(["owner"])).toEqual([...STAFF_CAPABILITIES]);
    expect(Object.keys(ROLE_CAPABILITIES)).not.toContain("owner");
  });

  it("roles add up", () => {
    const both = new Set(capabilitiesOf(["moderator", "legal"]));
    for (const c of [...EXPECTED_CAPABILITIES.moderator, ...EXPECTED_CAPABILITIES.legal]) {
      expect(both.has(c)).toBe(true);
    }
    expect(both.has("staff.manage")).toBe(false);
    expect(capabilitiesOf([])).toEqual([]);
  });

  it("only owner can manage staff; only legal and owner can file NCMEC reports", () => {
    for (const role of STAFF_ROLES) {
      const caps = capabilitiesOf([role]);
      expect(caps.includes("staff.manage")).toBe(role === "owner");
      expect(caps.includes("csam.report")).toBe(role === "legal" || role === "owner");
    }
  });

  it("parses comma separated roles and ignores unknown ones", () => {
    expect(parseRoles("legal, admin,legal,root")).toEqual(["legal", "admin"]);
    expect(parseRoles(null)).toEqual([]);
  });
});
