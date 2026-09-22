/**
 * Session：Runtime 在每次组装时提供的运行时状态。它不属于 Creation，也不会写回 IR。
 */
import { LocaleSchema } from "@char-pub/core";
import { z } from "zod";

/**
 * 绑定到 late slot 的对象。必须是一个真正的 Character 或 Persona，不能只是一个用户名，
 * 所以 kind 和 display_name 都是必填的。
 */
export const LateBindingValueSchema = z.strictObject({
  kind: z.enum(["persona", "character"]),
  display_name: z.string().min(1),
  /** 设定描述。存在时作为 Session 内容单独加入上下文。 */
  description: z.string().min(1).optional(),
});
export type LateBindingValue = z.infer<typeof LateBindingValueSchema>;

export const HistoryMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  /** 多角色对话中说这句话的 participant key。 */
  speaker: z.string().optional(),
  text: z.string(),
});
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;

export const SessionOverlaySchema = z.strictObject({
  memory: z.array(z.string().min(1)).optional(),
  state: z.record(z.string().min(1), z.string()).optional(),
  /** asset slot → 当前使用的 variant，例如 `avatar: embarrassed`。 */
  active_variants: z.record(z.string().min(1), z.string().min(1)).optional(),
});

export const SessionSchema = z.strictObject({
  locale: LocaleSchema.optional(),
  /** late slot key → 绑定对象。隐式用户的 key 是 `user`。 */
  bindings: z.record(z.string().min(1), LateBindingValueSchema).default({}),
  /** 按时间顺序排列，最后一条是最新消息。 */
  history: z.array(HistoryMessageSchema).default([]),
  /** 用户或 Runtime 显式启用的 fragment（完整 IR fragment ID）。 */
  manual_enabled: z.array(z.string().min(1)).optional(),
  overlay: SessionOverlaySchema.optional(),
  /** per-agent 模式下为哪个 participant 组装，默认是根角色 `self`。 */
  for_participant: z.string().min(1).optional(),
  /** 当前场景。只有场景匹配时，限定在某个场景的 fragment 才会加入。 */
  scene: z.string().min(1).optional(),
});
export type Session = z.output<typeof SessionSchema>;
export type SessionInput = z.input<typeof SessionSchema>;
