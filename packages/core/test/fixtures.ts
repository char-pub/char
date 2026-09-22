/** 测试用的固定 ID 与样例数据。所有 ID 都是合法的 TypeID，值本身没有意义。 */
import type { CreationInput } from "../src/schema/creation.js";

const SUFFIX = "01h455vb4pex5vsknk084sn0";

/** 生成确定的测试 ID：`tid("cr", 1)` → `cr_01h455vb4pex5vsknk084sn01`。 */
export function tid(prefix: string, n: number): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const a = alphabet[Math.floor(n / 32) % 32] ?? "0";
  const b = alphabet[n % 32] ?? "0";
  return `${prefix}_${SUFFIX}${a}${b}`;
}

export const D = (c: string): string => `sha256:${c.repeat(64).slice(0, 64)}`;

export function level0Character(overrides: Partial<CreationInput> = {}): CreationInput {
  return {
    id: tid("cr", 1),
    ref: "@djj/alice",
    type: "character",
    display_name: "Alice",
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "{{self}} is a courier in Night City." },
      },
    ],
    bootstrap: { greetings: [{ id: "default", text: "Hi, you're late again." }] },
    assets: [
      {
        slot: "avatar",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/webp",
            blob: { digest: D("a"), size: 1024, availability: "mirrored" },
          },
        ],
      },
    ],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    ...overrides,
  };
}
