import { z } from "zod";

/** Unknown future IDs remain representable so consumers can report unsupported requirements. */
export const CapabilitySchema = z.strictObject({
  id: z.string().min(1),
  experimental: z.literal(true).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilitiesSchema = z.array(CapabilitySchema).superRefine((items, ctx) => {
  for (let i = 1; i < items.length; i++) {
    const before = items[i - 1];
    const after = items[i];
    if (before && after && before.id >= after.id)
      ctx.addIssue({
        code: "custom",
        path: [i, "id"],
        message: "capability IDs must be unique and sorted",
      });
  }
});
