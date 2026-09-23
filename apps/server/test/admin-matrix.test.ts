/**
 * admin 路由的权限矩阵：对每个已注册的路由 × 每种员工角色自动生成用例。
 * 期望值由 `roles.ts` 的能力矩阵推导（每个路由声明它需要的能力），不在测试里另写一份矩阵。
 *
 * 为了不产生副作用，写操作只发送空请求体：有权限时得到 422（缺少理由或参数），
 * 没有权限时得到 403 `admin.forbidden`。授权检查发生在参数校验之前，所以两者能区分开。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { type AdminRouteSpec, registeredAdminRoutes } from "../src/admin/app.js";
import { type StaffCapability, staffCan } from "../src/admin/roles.js";
import {
  type AdminHarness,
  adminAppForInspection,
  createAdminHarness,
  ROLES,
} from "./fixtures/admin-harness.js";

let h: AdminHarness;
beforeAll(async () => {
  h = await createAdminHarness();
});
afterAll(async () => {
  await h.close();
});

const routes = registeredAdminRoutes(adminAppForInspection(new Uint8Array(32)));

function concretePath(path: string): string {
  return path
    .replace(":ref{.+}", "@nobody/nothing")
    .replace(":key", "uploads")
    .replace(":slug", "nobody")
    .replace(":queue", "publish")
    .replace(/:[a-z_]+/g, "01900000-0000-7000-8000-000000000000");
}

function required(spec: AdminRouteSpec<z.ZodType | undefined>): readonly StaffCapability[] {
  const cap = (spec.method !== "get" && spec.capabilityOf?.({})) || spec.capability;
  return Array.isArray(cap) ? cap : [cap as StaffCapability];
}

describe("every admin route is authorized by the capability matrix", () => {
  it("covers all route groups", () => {
    const paths = new Set(routes.map((r) => r.path));
    for (const p of [
      "/v1/admin/me",
      "/v1/admin/reports",
      "/v1/admin/reports/:id/actions",
      "/v1/admin/creations/:id/rating",
      "/v1/admin/tombstones",
      "/v1/admin/approvals/:id/confirm",
      "/v1/admin/users/:id/ban",
      "/v1/admin/guests/:id/disable",
      "/v1/admin/reserved-names",
      "/v1/admin/namespaces/:slug/rename",
      "/v1/admin/csam/flag",
      "/v1/admin/legal-requests",
      "/v1/admin/queues",
      "/v1/admin/staff/:user_id",
      "/v1/admin/users/:id/upload-lock",
      "/v1/admin/users/:id/revoke",
      "/v1/admin/namespaces/:slug/transfer",
      "/v1/admin/legal-requests/:id/counter-notice",
      "/v1/admin/legal-requests/:id/restore",
      "/v1/admin/legal-requests/:id/export",
      "/v1/admin/audit/export",
      "/v1/admin/csam-incidents/:id/evidence",
      "/v1/admin/csam-evidence/:ticket",
      "/v1/admin/staff/:user_id/sign-out",
    ]) {
      expect(paths.has(p)).toBe(true);
    }
  });

  for (const spec of routes) {
    for (const role of ROLES) {
      const allowed = required(spec).some((cap) => staffCan([role], cap));
      const name = `${spec.method.toUpperCase()} ${spec.path} as ${role} → ${allowed ? "allowed" : "403"}`;
      it(name, async () => {
        const r = await h.call(
          h.staff[role].email,
          spec.method.toUpperCase(),
          concretePath(spec.path),
          spec.method === "get" ? undefined : {},
        );
        if (allowed) {
          expect(r.json.code).not.toBe("admin.forbidden");
          if (spec.method !== "get") expect(r.status).toBe(422);
        } else {
          expect(r).toMatchObject({ status: 403, json: { code: "admin.forbidden" } });
        }
      });
    }
  }
});

describe("write routes require a reason", () => {
  const writes = routes.filter((r) => r.method !== "get" && !r.readOnly);
  for (const spec of writes) {
    it(`${spec.method.toUpperCase()} ${spec.path} without a reason → 422 admin.reason_required`, async () => {
      const r = await h.call(
        h.staff.owner.email,
        spec.method.toUpperCase(),
        concretePath(spec.path),
        {
          reason: "short",
        },
      );
      expect(r).toMatchObject({ status: 422, json: { code: "admin.reason_required" } });
    });
  }

  it("legal takedowns require a linked legal request", async () => {
    const r = await h.call(h.staff.legal.email, "POST", "/v1/admin/tombstones", {
      subject: "@nobody/nothing",
      reason_code: "legal.dmca",
      reason: "DMCA notice received today",
    });
    expect(r).toMatchObject({ status: 422, json: { code: "admin.legal_request_required" } });
  });
});
