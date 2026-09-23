/**
 * 在浏览器里导入角色卡（CCv3 / CCv2 / PNG / CHARX / JSON）。
 *
 * 转换完全在本地完成（`@char-pub/ccv3`），原件不上传。转换结果写进一个新 Creation 的
 * 草稿；卡片里的图片单独走上传流程（服务端重新编码，去除卡片元数据），完成后替换草稿中
 * 的 blob 引用。以后服务端提供 `POST /v1/imports` 时，这一步可以改为上传原件由服务端转换。
 */
import { type ImportResult, importCard, type Rights } from "@char-pub/ccv3";
import { type CreationInput, isCharError, type Rating } from "@char-pub/core";
import type { RegistryClient } from "./api";
import type { BlobInfo } from "./draft";
import { uploadImage } from "./upload";

/** 预览时使用的占位 ID 与 ref；真正写入草稿时服务端会换成新 Creation 的值。 */
export const PREVIEW_ID = "cr_00000000000000000000000000";
export const PREVIEW_REF = "@preview/card";

export interface ImportChoices {
  rating?: Rating | undefined;
  rights?: Rights | undefined;
  license?: string | undefined;
}

export class ImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

/** 把文件内容转换成 Creation；格式不对时抛出 `ImportError`。 */
export function convertCard(
  input: Uint8Array,
  opts: ImportChoices & { id?: string; ref?: string } = {},
): ImportResult {
  try {
    return importCard(input, {
      ids: { creation: opts.id ?? PREVIEW_ID },
      ref: opts.ref ?? PREVIEW_REF,
      ...(opts.rating ? { rating: opts.rating } : {}),
      ...(opts.rights ? { rights: opts.rights } : {}),
      ...(opts.license ? { license: opts.license } : {}),
    });
  } catch (e) {
    if (isCharError(e)) {
      throw new ImportError(e.code, e.detail ?? "This file is not a character card we can read.");
    }
    throw new ImportError("import.failed", "This file is not a character card we can read.");
  }
}

/** 卡片中的名字（用来预填名字与地址）。 */
export function cardName(result: ImportResult): string {
  const d = result.creation.display_name;
  return typeof d === "string" ? d : (Object.values(d)[0] ?? "");
}

/** 标记为 stable: false 的 lore 条目：可以运行，但别人不能针对它们做 override。 */
export function unstableEntries(result: ImportResult): string[] {
  return (result.creation.fragments ?? []).filter((f) => !f.stable).map((f) => f.id);
}

/**
 * 上传卡片里的图片，并把草稿中的 blob 引用换成上传后的结果。上传失败的图片从草稿中
 * 移除（连同引用它的 fragment），并返回它们的名字。
 */
export async function uploadCardAssets(
  client: RegistryClient,
  result: ImportResult,
  upload: (blob: Blob) => Promise<BlobInfo> = (b) => uploadImage(client, b),
): Promise<{ creation: CreationInput; failed: string[] }> {
  const uploaded = new Map<string, BlobInfo>();
  const failed: string[] = [];
  for (const a of result.assets) {
    const key = `${a.slot}/${a.variant}`;
    try {
      const bytes = new Uint8Array(a.bytes);
      uploaded.set(key, await upload(new Blob([bytes], { type: a.media_type })));
    } catch {
      failed.push(key);
    }
  }
  const slots = (result.creation.assets ?? [])
    .map((s) => ({
      ...s,
      variants: s.variants
        .filter((v) => uploaded.has(`${s.slot}/${v.id}`))
        .map((v) => {
          const b = uploaded.get(`${s.slot}/${v.id}`) as BlobInfo;
          return {
            ...v,
            media_type: b.media_type,
            blob: { digest: b.digest, size: b.size, availability: "mirrored" as const },
          };
        }),
    }))
    // 默认变体上传失败时整个 slot 都不能用。
    .filter((s) => s.variants.some((v) => v.id === "default"));
  const kept = new Set(slots.map((s) => s.slot));
  const refOk = (ref: string) => kept.has(ref.split("/")[1] ?? "");
  const fragments = (result.creation.fragments ?? [])
    .filter((f) => f.content.type !== "media" || refOk(f.content.asset))
    .map((f) => (f.asset_refs ? { ...f, asset_refs: f.asset_refs.filter(refOk) } : f));
  return { creation: { ...result.creation, assets: slots, fragments }, failed };
}
