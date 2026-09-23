/**
 * 内部 ID 与对外编码的转换。数据库里存 uuid（UUIDv7），API 与 Canonical JSON 里用
 * TypeID：`<前缀>_<26 位 base32>`，前缀表明对象类型，例如 `cr_…`、`rel_…`。
 */
import { ID_PREFIXES, type IdKind } from "@char-pub/core";
import { TypeID } from "typeid-js";

export function encodeId(kind: IdKind, uuid: string): string {
  return TypeID.fromUUID(ID_PREFIXES[kind], uuid).toString();
}

/** 解析 TypeID；格式错误或前缀不符时返回 null。 */
export function decodeId(kind: IdKind, id: string): string | null {
  try {
    return TypeID.fromString(id, ID_PREFIXES[kind]).toUUID();
  } catch {
    return null;
  }
}
