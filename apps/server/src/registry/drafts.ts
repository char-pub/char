/**
 * 草稿的初始内容与服务端强制字段。
 *
 * 草稿里的 `id`、`ref`、`type` 由服务端决定：客户端提交什么都会被覆盖，这样作者无法把
 * 草稿伪装成另一个 Creation。`ref` 总是使用 namespace 的当前名字，namespace 改名后
 * 下一次保存就会更新。
 */
import type { AttributionAuthor, CreationType, LocalizedText } from "@char-pub/core";

/**
 * 新建 Creation 时的草稿。许可默认“保留所有权利”：作者本人可以发布，别人不能再分发，
 * 这是在作者做出选择之前最保守的默认值。作者默认是新建它的用户，作者可以在编辑器里修改。
 */
export function initialDraft(input: {
  id: string;
  ref: string;
  type: CreationType;
  display_name: LocalizedText;
  author: AttributionAuthor;
}): Record<string, unknown> {
  return {
    id: input.id,
    ref: input.ref,
    type: input.type,
    display_name: input.display_name,
    authors: [input.author],
    fragments: [],
    meta: {
      default_locale: "en",
      rating: "general",
      rights: "original",
      license: "LicenseRef-All-Rights-Reserved",
    },
  };
}

export function forceIdentity(
  working: Record<string, unknown>,
  identity: { id: string; ref: string; type: CreationType },
): Record<string, unknown> {
  return { ...working, id: identity.id, ref: identity.ref, type: identity.type };
}
