/**
 * 草稿的初始内容与服务端强制字段。
 *
 * 草稿里的 `id`、`ref`、`type` 由服务端决定：客户端提交什么都会被覆盖，这样作者无法把
 * 草稿伪装成另一个 Creation。`ref` 总是使用 namespace 的当前名字，namespace 改名后
 * 下一次保存就会更新。
 */
import {
  type AttributionAuthor,
  type CreationType,
  type LocalizedText,
  PRESET_REGIONS,
} from "@char-pub/core";

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
  const draft: Record<string, unknown> = {
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
  const fragment = (kind: string, text: string) => ({
    id: "description",
    stable: true,
    kind,
    content: { type: "text", text },
  });
  if (input.type === "preset") {
    draft.policy = {
      version: "0-draft",
      blocks: [],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    };
  } else if (input.type === "prompt-module") {
    draft.prompt_module = { version: "0-draft", blocks: [] };
  } else if (input.type === "relationship") {
    draft.slots = {
      first: { accepts: ["character", "persona"], required: false },
      second: { accepts: ["character", "persona"], required: false },
    };
    draft.fragments = [fragment("relationship", "Describe their relationship.")];
  } else if (input.type === "scenario") {
    draft.cast = [{ key: "player", who: { late: "persona" }, role: "user" }];
    draft.fragments = [fragment("scenario", "Describe the opening situation.")];
  } else if (input.type === "persona" || input.type === "style") {
    draft.fragments = [
      fragment(
        input.type,
        input.type === "persona" ? "Describe your persona." : "Describe the expressive style.",
      ),
    ];
  }
  return draft;
}

export function forceIdentity(
  working: Record<string, unknown>,
  identity: { id: string; ref: string; type: CreationType },
): Record<string, unknown> {
  return { ...working, id: identity.id, ref: identity.ref, type: identity.type };
}
