/**
 * 员工锁定上传后，该用户不能再申请上传或导入角色卡（返回 403 `upload.locked`）。
 * 已上传的文件与已发布的内容不受影响。
 */
import { eq } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { uploadLocks } from "../db/schema/index.js";

export async function uploadsLocked(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: uploadLocks.userId })
    .from(uploadLocks)
    .where(eq(uploadLocks.userId, userId))
    .limit(1);
  return row !== undefined;
}
