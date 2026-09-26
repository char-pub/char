import { z } from "zod";
import { DIGEST_RE, idPattern, NAME_RE, NAMESPACE_RE, SEGMENT_RE } from "../ids.js";

export const ExactRefSchema = z.strictObject({
  ref: z
    .string()
    .regex(new RegExp(`^@${NAMESPACE_RE.source.slice(1, -1)}/${NAME_RE.source.slice(1, -1)}$`)),
  release: z.string().regex(idPattern("release")),
  semantic_digest: z.string().regex(DIGEST_RE),
});
export type ExactRef = z.infer<typeof ExactRefSchema>;
export const PolicyImportSchema = z.strictObject({
  id: z.string().regex(SEGMENT_RE),
  use: ExactRefSchema.shape.ref,
  pin: ExactRefSchema.omit({ ref: true }),
});
export type PolicyImport = z.infer<typeof PolicyImportSchema>;

export const EngineIdentitySchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
});
