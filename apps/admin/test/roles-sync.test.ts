// @vitest-environment node
/**
 * 前端的员工角色表必须与 admin 进程中的角色表一致。
 *
 * 两个 app 之间不能互相 import，所以这里把服务端的源文件当文本读取，解析出角色列表、
 * 能力列表与能力矩阵，与前端的表逐项比对。解析失败也算失败，避免服务端改写法后静默跳过。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../src/lib/api";
import { ROLE_CAPABILITIES, STAFF_CAPABILITIES } from "../src/lib/roles";

const source = readFileSync(new URL("../../server/src/admin/roles.ts", import.meta.url), "utf8");

function stringsIn(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

function constArray(name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(source);
  if (!m?.[1]) throw new Error(`could not find ${name} in the server role table`);
  return stringsIn(m[1]);
}

function serverMatrix(): Record<string, string[]> {
  const start = source.indexOf("const MATRIX");
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("could not find MATRIX in the server role table");
  const body = source.slice(source.indexOf("= {", start) + 3, end);
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1] ?? ""] = stringsIn(m[2] ?? "");
  }
  return out;
}

describe("staff role table matches the admin server", () => {
  it("has the same roles in the same order", () => {
    expect(constArray("STAFF_ROLES")).toEqual([...STAFF_ROLES]);
  });

  it("has the same capabilities in the same order", () => {
    expect(constArray("STAFF_CAPABILITIES")).toEqual([...STAFF_CAPABILITIES]);
  });

  it("grants every role the same capabilities", () => {
    const server = serverMatrix();
    expect(Object.keys(server).sort()).toEqual(Object.keys(ROLE_CAPABILITIES).sort());
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      expect(new Set(server[role]), role).toEqual(new Set(caps));
    }
  });
});
