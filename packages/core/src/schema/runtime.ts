import { z } from "zod";

const LocaleSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/);
export const RuntimeProfileSchema = z.strictObject({
  runtime: z.strictObject({ name: z.string(), version: z.string() }),
  model: z.string().optional(),
  /** 具体 tokenizer 名，或 `estimate` 表示只做估算。 */
  tokenizer: z.string(),
  context_window: z.number().int().positive(),
  reserve_for_output: z.number().int().nonnegative(),
  /** per-agent 模式下 private visibility 是隔离边界；narrator 模式下只是提示。 */
  mode: z.enum(["narrator", "per-agent"]),
  capabilities: z.strictObject({
    images: z.boolean().optional(),
    system_role: z.boolean().optional(),
    multiple_system_messages: z.boolean().optional(),
  }),
  locale: LocaleSchema.optional(),
});
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
