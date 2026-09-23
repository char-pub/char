/**
 * 角色卡导入的共用部分：名字占用检查、状态响应，以及发布前的确认检查。
 */
import type { ImportStatus } from "@char-pub/contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { creationRedirects, creations, imports } from "../db/schema/index.js";
import { encodeId } from "./ids.js";

export type ImportRow = typeof imports.$inferSelect;

/** 名字已被一个 Creation 使用，或者曾经被使用过（改名留下的旧名永久占用）。 */
export async function nameTaken(db: Executor, namespaceId: string, name: string): Promise<boolean> {
  const [taken] = await db
    .select({ id: creations.id })
    .from(creations)
    .where(and(eq(creations.namespaceId, namespaceId), eq(creations.name, name)))
    .limit(1);
  if (taken) return true;
  const [redirected] = await db
    .select({ id: creationRedirects.creationId })
    .from(creationRedirects)
    .where(and(eq(creationRedirects.namespaceId, namespaceId), eq(creationRedirects.oldName, name)))
    .limit(1);
  return redirected !== undefined;
}

export function importStatusBody(
  row: ImportRow,
  extra: { creation?: string | undefined; report?: ImportStatus["report"] | undefined } = {},
): ImportStatus {
  const out: ImportStatus = {
    import: encodeId("import", row.id),
    status: row.status,
    needs_confirmation: row.confirmedAt
      ? []
      : (row.needsConfirmation as ImportStatus["needs_confirmation"]),
    confirmed_at: row.confirmedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
  if (row.errorCode) out.error_code = row.errorCode;
  if (row.errorDetail) out.error_detail = row.errorDetail;
  if (extra.creation) out.creation = extra.creation;
  if (extra.report) out.report = extra.report;
  return out;
}

/**
 * 这个 Creation 是否由一个还没确认评级、权利与许可的导入生成。卡片本身不声明这三项，
 * 导入时填的只是占位值，作者确认之前不能发布。
 */
export async function hasUnconfirmedImport(db: Executor, creationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(
        eq(imports.creationId, creationId),
        eq(imports.status, "succeeded"),
        isNull(imports.confirmedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}
