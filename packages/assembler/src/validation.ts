import { CharError } from "@char-pub/core";
import type { z } from "zod";

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  subject: string,
  code = "assemble.invalid_input",
): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new CharError({
      code,
      subject,
      detail: first ? `${first.path.join(".") || "$"}: ${first.message}` : "invalid",
    });
  }
  return r.data;
}
