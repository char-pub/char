/**
 * Revision 与 Release 内容在对象存储中的布局。
 *
 * Revision：
 * - 每个 fragment 单独存成一个对象，内容是去掉 `digest` 字段后的 canonical fragment 的
 *   JCS 序列化，所以对象 key 恰好就是 fragment digest；
 * - manifest（Creation 把 fragments 换成 `[id, digest]` 列表）存成一个对象，key 恰好就是
 *   semantic digest。
 * 读取时按 manifest 里的顺序取回 fragment，重新 canonicalize，并核对 semantic digest。
 *
 * Release 快照：发布时把根 Creation 与闭包中每个依赖的 canonical Creation 存进一个对象，
 * 这样即使依赖以后被 yank，这个 Release 仍然可以从快照完整重建。格式：
 *
 *   { "snapshot_version": 1,
 *     "root": <canonical Creation>,
 *     "dependencies": [ { "release", "ref", "semantic_digest", "creation" }, … ] }   // 按 ref 排序
 *
 * 整个对象按 JCS 序列化，key 是它的 sha256。
 */
import {
  type CanonicalCreation,
  CharError,
  canonicalizeCreation,
  compareStrings,
  type Digest,
  type JSONValue,
  jcs,
  normalizeValue,
} from "@char-pub/core";
import type { Executor } from "../db/client.js";
import { type Bucket, type Cas, CasError } from "../storage/cas.js";

const JSON_TYPE = "application/json";
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export const SNAPSHOT_VERSION = 1;

function jsonBytes(value: JSONValue): Uint8Array {
  return enc.encode(jcs(value));
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(dec.decode(bytes));
}

/** 去掉 digest 字段后的 canonical fragment，它的 JCS 就是 fragment digest 的原文。 */
function fragmentBody(f: CanonicalCreation["fragments"][number]): JSONValue {
  const { digest: _d, ...body } = f;
  return normalizeValue(body);
}

export interface StoredRevision {
  semantic_digest: Digest;
  fragments: { id: string; digest: Digest; kind: string; stable: boolean; position: number }[];
}

/** 把一个 canonical Creation 写入 private 桶。已存在的对象不会重复上传。 */
export async function storeRevisionContent(
  db: Executor,
  cas: Cas,
  canonical: ReturnType<typeof canonicalizeCreation>,
): Promise<StoredRevision> {
  const fragments: StoredRevision["fragments"] = [];
  for (const [position, f] of canonical.creation.fragments.entries()) {
    await cas.putBlob(db, {
      bucket: "private",
      bytes: jsonBytes(fragmentBody(f)),
      mediaType: JSON_TYPE,
      kind: "fragment",
      digest: f.digest,
    });
    fragments.push({ id: f.id, digest: f.digest, kind: f.kind, stable: f.stable, position });
  }
  await cas.putBlob(db, {
    bucket: "private",
    bytes: jsonBytes(canonical.manifest),
    mediaType: JSON_TYPE,
    kind: "manifest",
    digest: canonical.semantic_digest,
  });
  return { semantic_digest: canonical.semantic_digest, fragments };
}

/**
 * 从 private 桶重建 Revision 的 canonical Creation，并核对内容没有被改动。
 * 对象缺失或与 digest 不符时抛出 `registry.revision_corrupt`：这类错误重试也不会恢复。
 */
export async function loadRevisionContent(
  cas: Cas,
  semanticDigest: string,
): Promise<ReturnType<typeof canonicalizeCreation>> {
  const read = async (digest: string) => {
    try {
      return parseJson(await cas.getBlob("private", digest));
    } catch (e) {
      if (!(e instanceof CasError)) throw e;
      throw new CharError({ code: "registry.revision_corrupt", subject: digest, detail: e.code });
    }
  };
  const manifest = (await read(semanticDigest)) as Record<string, unknown> & {
    fragment_digests?: [string, string][];
  };
  const { fragment_digests: list = [], ...rest } = manifest;
  const fragments: unknown[] = [];
  for (const [, digest] of list) fragments.push(await read(digest));
  const result = canonicalizeCreation({ ...rest, fragments });
  if (result.semantic_digest !== semanticDigest) {
    throw new CharError({
      code: "registry.revision_corrupt",
      subject: semanticDigest,
      detail: `stored content hashes to ${result.semantic_digest}`,
    });
  }
  return result;
}

export interface SnapshotDependency {
  release: string;
  ref: string;
  semantic_digest: string;
  creation: JSONValue;
}

export interface Snapshot {
  snapshot_version: typeof SNAPSHOT_VERSION;
  root: JSONValue;
  dependencies: SnapshotDependency[];
}

export function buildSnapshot(root: JSONValue, dependencies: SnapshotDependency[]): Uint8Array {
  const deps = [...dependencies].sort((a, b) => compareStrings(a.ref, b.ref));
  return jsonBytes(
    normalizeValue({
      snapshot_version: SNAPSHOT_VERSION,
      root,
      dependencies: deps,
    } satisfies Snapshot),
  );
}

export async function loadSnapshot(
  cas: Cas,
  bucket: Exclude<Bucket, "uploads" | "evidence">,
  digest: string,
): Promise<Snapshot> {
  const v = parseJson(await cas.getBlob(bucket, digest)) as Snapshot;
  if (v.snapshot_version !== SNAPSHOT_VERSION) {
    throw new CharError({ code: "registry.snapshot_version", subject: digest });
  }
  return v;
}

export function irBytes(json: string): Uint8Array {
  return enc.encode(json);
}
