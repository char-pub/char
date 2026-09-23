/** Only local, processed avatar blobs can be used as thumbnails. */
import { isDigest } from "@char-pub/core";
export function avatarDigest(working: unknown): string | null {
  const assets = (
    working as {
      assets?: {
        slot?: string;
        variants?: { media_type?: string; blob?: { digest?: string; availability?: string } }[];
      }[];
    } | null
  )?.assets;
  if (!Array.isArray(assets)) return null;
  const variant = assets.find((a) => a.slot === "avatar")?.variants?.[0];
  const blob = variant?.blob;
  return blob?.digest &&
    isDigest(blob.digest) &&
    blob.availability === "mirrored" &&
    variant?.media_type === "image/webp"
    ? blob.digest
    : null;
}
