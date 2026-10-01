import { uuidv7 } from "uuidv7";
import type { Db } from "../../src/db/client.js";
import { uploads } from "../../src/db/schema/index.js";

/** A completed upload fixture; the caller separately persists bytes and ready asset metadata. */
export async function grantUploadedAsset(
  db: Db,
  ownerUserId: string,
  blob: { digest: string; size: number },
  mediaType = "image/webp",
) {
  const id = uuidv7();
  await db.insert(uploads).values({
    id,
    ownerUserId,
    status: "ready",
    declaredType: mediaType,
    size: blob.size,
    stagingKey: `test-completed-upload/${id}`,
    result: { blob: { ...blob, media_type: mediaType } },
    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
  });
}
