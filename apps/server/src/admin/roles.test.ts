import { describe, expect, it } from "vitest";
import {
  COOLING_OFF_MS,
  canConfirm,
  capabilitiesOf,
  requiresFourEyes,
  STAFF_CAPABILITIES,
  STAFF_ROLES,
  type StaffCapability,
  type StaffRole,
  staffCan,
  validateStaffAction,
} from "./roles.js";

/** 与 admin 设计文档中的能力矩阵逐格对照。 */
const EXPECTED: Record<StaffCapability, StaffRole[]> = {
  "overview.read": ["viewer", "moderator", "trust_safety", "legal", "admin", "owner"],
  "reports.handle": ["moderator", "trust_safety", "admin", "owner"],
  "creations.hide": ["moderator", "trust_safety", "admin", "owner"],
  "releases.yank": ["moderator", "trust_safety", "admin", "owner"],
  "users.ban": ["trust_safety", "admin", "owner"],
  "csam.read": ["trust_safety", "legal", "owner"],
  "csam.report": ["legal", "owner"],
  "legal.manage": ["legal", "owner"],
  "tombstone.policy": ["trust_safety", "owner"],
  "tombstone.legal": ["legal", "owner"],
  "namespaces.govern": ["admin", "owner"],
  "flags.toggle": ["trust_safety", "admin", "owner"],
  "jobs.manage": ["admin", "owner"],
  "audit.read_own": ["viewer", "owner"],
  "audit.read_all": ["legal", "admin", "owner"],
  "staff.manage": ["owner"],
};

describe("staff capability matrix", () => {
  for (const cap of STAFF_CAPABILITIES) {
    for (const role of STAFF_ROLES) {
      const allowed = EXPECTED[cap].includes(role);
      it(`${role} ${allowed ? "can" : "cannot"} ${cap}`, () => {
        expect(staffCan([role], cap)).toBe(allowed);
      });
    }
  }

  it("roles combine", () => {
    const caps = capabilitiesOf(["moderator", "legal"]);
    expect(caps.has("reports.handle")).toBe(true);
    expect(caps.has("tombstone.legal")).toBe(true);
    expect(caps.has("staff.manage")).toBe(false);
    expect(capabilitiesOf([]).size).toBe(0);
  });
});

describe("staff action requirements", () => {
  it("requires a reason of at least 10 characters", () => {
    expect(validateStaffAction({ capability: "users.ban", reason: "spam" })).toEqual({
      ok: false,
      code: "admin.reason_required",
    });
    expect(validateStaffAction({ capability: "users.ban", reason: undefined })).toMatchObject({
      ok: false,
    });
    expect(validateStaffAction({ capability: "users.ban", reason: "   repeated spam   " })).toEqual(
      { ok: true },
    );
  });

  it("requires a legal request for legal actions", () => {
    expect(
      validateStaffAction({ capability: "tombstone.legal", reason: "DMCA notice received" }),
    ).toEqual({
      ok: false,
      code: "admin.legal_request_required",
    });
    expect(
      validateStaffAction({
        capability: "tombstone.legal",
        reason: "DMCA notice received",
        legal_request_id: "lr1",
      }),
    ).toEqual({ ok: true });
  });
});

describe("four-eyes rule", () => {
  it("applies to large tombstones, CSAM unbans and removing owners", () => {
    expect(requiresFourEyes({ kind: "tombstone", affected_releases: 51 })).toBe("tombstone.large");
    expect(requiresFourEyes({ kind: "tombstone", affected_releases: 50 })).toBeNull();
    expect(requiresFourEyes({ kind: "unban", csam_locked: true })).toBe("unban.csam");
    expect(requiresFourEyes({ kind: "unban" })).toBeNull();
    expect(requiresFourEyes({ kind: "staff.remove_role", role: "owner" })).toBe(
      "staff.remove_owner",
    );
    expect(requiresFourEyes({ kind: "staff.remove_role", role: "admin" })).toBeNull();
  });

  it("needs a second person, or a cooling-off period when nobody else is eligible", () => {
    const p = {
      kind: "tombstone.large" as const,
      initiated_by: "a",
      initiated_at: 0,
      other_eligible_staff: 1,
    };
    expect(canConfirm(p, "b", 1)).toEqual({ ok: true });
    expect(canConfirm(p, "a", COOLING_OFF_MS * 10)).toEqual({
      ok: false,
      code: "admin.four_eyes_required",
    });
    const solo = { ...p, other_eligible_staff: 0 };
    expect(canConfirm(solo, "a", COOLING_OFF_MS - 1)).toEqual({
      ok: false,
      code: "admin.cooling_off",
    });
    expect(canConfirm(solo, "a", COOLING_OFF_MS)).toEqual({ ok: true });
  });
});
