import { CharError, MAX_SOURCE_BYTES } from "@char-pub/core";

export function decodeSourceBytes(bytes: Uint8Array, subject = "source"): string {
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    throw new CharError({ code: "source.too_large", subject });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new CharError({ code: "source.invalid_utf8", subject });
  }
  if (text.includes("\u0000")) throw new CharError({ code: "source.binary_content", subject });
  return text;
}
