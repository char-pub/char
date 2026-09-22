/**
 * Context IR 中各种 key 与 ID 的计算。Resolver、Assembler、Diff 和 CCv3 导出都依赖
 * 这些函数，所以它们必须只有一份实现。
 *
 * - 引用实例（instance）：同一个 Creation 沿不同 edge 路径引入时是不同的实例，各自有
 *   独立的 fragment、binding 和 override。根实例的 key 是 `root`，其他实例的 key 是
 *   edge ID 路径的 JCS 序列化的 sha256（64 位 hex，无前缀）。
 * - IR fragment ID：`<不带版本的 creation-ref>#<fragment-id>~<instance-key>`。
 * - 参与者 key：根角色固定为 `self`，Session 用户固定为 `user`，其他为
 *   `p:<sha256(JCS([instance_key, slot 或 cast key]))>`。
 * - late slot key：隐式用户固定为 `user`，其他为 `l:<sha256(JCS([instance_key, slot]))>`。
 *
 * 这些 key 只取决于稳定的 edge ID 与 slot 名，所以同一路径在不同 Release 中可以比较；
 * edge ID 或路径改变就形成新的实例。
 */

import type { Digest } from "./canonical.js";
import { digestJson, jcs, sha256Hex } from "./canonical.js";
import type { JSONValue } from "./schema/creation.js";
import type { IRFragment } from "./schema/ir.js";

export const ROOT_INSTANCE = "root";
export const SELF_PARTICIPANT = "self";
export const USER_PARTICIPANT = "user";
export const USER_LATE_SLOT = "user";

export function instanceKey(via: readonly string[]): string {
  return via.length === 0 ? ROOT_INSTANCE : sha256Hex(jcs([...via]));
}

export function participantKey(instance: string, slotOrCast: string): string {
  return `p:${sha256Hex(jcs([instance, slotOrCast]))}`;
}

export function lateSlotKey(instance: string, slot: string): string {
  return `l:${sha256Hex(jcs([instance, slot]))}`;
}

/** IR 中说话人与 visibility 目标的写法。 */
export function participantRef(key: string): string {
  return `participant:${key}`;
}

export function irFragmentId(ref: string, fragmentId: string, instance: string): string {
  return `${ref}#${fragmentId}~${instance}`;
}

export function irAssetId(ref: string, slot: string, variant: string, instance: string): string {
  return `${ref}#asset/${slot}/${variant}~${instance}`;
}

/** 展示用的短 ID：去掉 `~instance-key`。Diff 与 Trace 必须使用完整 ID。 */
export function displayFragmentId(id: string): string {
  const i = id.lastIndexOf("~");
  return i < 0 ? id : id.slice(0, i);
}

export type IRFragmentSemantic = Pick<
  IRFragment,
  | "kind"
  | "content"
  | "locales"
  | "activation"
  | "visibility"
  | "importance"
  | "placement_hint"
  | "subject"
  | "asset_refs"
>;

/**
 * IR fragment 的语义 digest：只覆盖会影响进入模型的内容的字段，不含 id、origin 和
 * digest 自身。来源变化由 origin 单独比较。
 */
export function irFragmentDigest(f: IRFragmentSemantic): Digest {
  const body: Record<string, JSONValue> = {
    kind: f.kind,
    content: f.content as JSONValue,
    activation: f.activation as JSONValue,
    visibility: f.visibility as JSONValue,
    importance: f.importance,
    placement_hint: f.placement_hint,
  };
  if (f.locales !== undefined) body.locales = f.locales as JSONValue;
  if (f.subject !== undefined) body.subject = f.subject;
  if (f.asset_refs !== undefined) body.asset_refs = f.asset_refs;
  return digestJson(body);
}
