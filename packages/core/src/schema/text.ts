import { z } from "zod";

/** Shared text primitives keep content and story schemas independent. */
export const LocaleSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/);
export const LocalizedTextSchema = z.union([
  z.string().min(1),
  z.record(LocaleSchema, z.string().min(1)).refine((r) => Object.keys(r).length > 0),
]);
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
export const TemplateTextSchema = z.string();

/** Story templates keep authored language variants; `ref` is reserved for a greeting reference. */
export const LocalizedTemplateTextSchema = z.union([
  TemplateTextSchema,
  z
    .record(LocaleSchema.regex(/^(?!ref$)/), TemplateTextSchema)
    .refine((value) => Object.keys(value).length > 0, "expected at least one template locale"),
]);
export type LocalizedTemplateText = z.infer<typeof LocalizedTemplateTextSchema>;
