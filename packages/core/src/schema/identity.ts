import { z } from "zod";
import { CharError } from "../errors.js";
import { DIGEST_RE, idPattern, NAME_RE, NAMESPACE_RE, SEGMENT_RE } from "../ids.js";

export const ExactRefSchema = z.strictObject({
  ref: z
    .string()
    .regex(new RegExp(`^@${NAMESPACE_RE.source.slice(1, -1)}/${NAME_RE.source.slice(1, -1)}$`)),
  release: z.string().regex(idPattern("release")),
  semantic_digest: z.string().regex(DIGEST_RE),
});
export type ExactRef = z.infer<typeof ExactRefSchema>;

export const DraftBuildOriginSchema = z.strictObject({
  kind: z.literal("draft-build"),
  build_id: z.string().regex(idPattern("draft_build")),
  revision: z.string().regex(idPattern("revision")),
  expires_at: z.iso.datetime(),
});
export type DraftBuildOrigin = z.infer<typeof DraftBuildOriginSchema>;

export const LocalBuildOriginSchema = z.strictObject({
  kind: z.literal("local-build"),
  input_digest: z.string().regex(DIGEST_RE),
});
export type LocalBuildOrigin = z.infer<typeof LocalBuildOriginSchema>;
export const UnpublishedBuildOriginSchema = z.discriminatedUnion("kind", [
  DraftBuildOriginSchema,
  LocalBuildOriginSchema,
]);

/** Build provenance is separate from dependency identity: pins still use ExactRef. */
export function withBuildIdentity<T extends z.ZodRawShape>(shape: T) {
  return z.union([
    z.strictObject({ ...shape, release: ExactRefSchema.shape.release }),
    z.strictObject({ ...shape, origin: UnpublishedBuildOriginSchema }),
  ]);
}
export const BuildIdentitySchema = withBuildIdentity({});
export type BuildIdentity = z.infer<typeof BuildIdentitySchema>;
export const BuildRefSchema = withBuildIdentity({
  ref: ExactRefSchema.shape.ref,
  semantic_digest: ExactRefSchema.shape.semantic_digest,
});
export type BuildRef = z.infer<typeof BuildRefSchema>;

export function buildIdentity(value: BuildIdentity): BuildIdentity {
  const result = BuildIdentitySchema.safeParse({
    ...("release" in value ? { release: value.release } : {}),
    ...("origin" in value ? { origin: value.origin } : {}),
  });
  if (!result.success)
    throw new CharError({
      code: "schema.invalid",
      subject: "build.identity",
      detail: result.error.message,
    });
  return result.data;
}
export function buildIdentityKey(value: BuildIdentity): string {
  return "release" in value
    ? value.release
    : value.origin.kind === "draft-build"
      ? value.origin.build_id
      : `local:${value.origin.input_digest}`;
}
export function sameBuildIdentity(left: BuildIdentity, right: BuildIdentity): boolean {
  return buildIdentityKey(left) === buildIdentityKey(right);
}
export function publishedIdentity(value: BuildIdentity): { release: string } {
  const identity = buildIdentity(value);
  if (!("release" in identity))
    throw new CharError({ code: "build.release_required", subject: buildIdentityKey(identity) });
  return identity;
}
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
