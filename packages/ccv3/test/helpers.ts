/**
 * 测试辅助：生成合成的 PNG、CHARX 和卡片。所有内容都是为测试编写的合成数据。
 */
import { zipSync } from "fflate";
import { base64Encode, utf8Encode } from "../src/bytes.js";
import { encodeTextChunk, type PngChunk, writePngChunks } from "../src/png.js";

/** 一张 1×1 的灰度 PNG（IHDR + IDAT + IEND），数据块是合法的 zlib 流。 */
export function tinyPng(extra: PngChunk[] = []): Uint8Array {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  // zlib: 78 01，stored block，1 字节扫描线（filter 0 + 像素 0），adler32
  const idat = new Uint8Array([
    0x78, 0x01, 0x01, 0x02, 0x00, 0xfd, 0xff, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
  ]);
  return writePngChunks([
    { type: "IHDR", data: ihdr },
    ...extra,
    { type: "IDAT", data: idat },
    { type: "IEND", data: new Uint8Array(0) },
  ]);
}

export function cardChunk(keyword: "ccv3" | "chara", card: unknown): PngChunk {
  return encodeTextChunk(keyword, base64Encode(utf8Encode(JSON.stringify(card))));
}

export function pngCard(
  card: unknown,
  opts: { v2?: unknown; extra?: PngChunk[] } = {},
): Uint8Array {
  const chunks = [cardChunk("ccv3", card)];
  if (opts.v2 !== undefined) chunks.push(cardChunk("chara", opts.v2));
  return tinyPng([...chunks, ...(opts.extra ?? [])]);
}

export function charx(files: Record<string, Uint8Array | string>, level: 0 | 6 = 6): Uint8Array {
  const z: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [k, v] of Object.entries(files))
    z[k] = [typeof v === "string" ? utf8Encode(v) : v, { level }];
  return zipSync(z);
}

export function v3Card(data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Mira",
      description: "{{char}} is a lighthouse keeper who talks to {{user}} about storms.",
      personality: "Calm, dry humor.",
      scenario: "A stormy night at the lighthouse.",
      first_mes: "You're soaked. Come in, {{user}}.",
      alternate_greetings: ["Oh. It's you again.", "", "The lamp needs fixing."],
      mes_example:
        "<START>\n{{user}}: Is the storm bad?\n{{char}}: Worst in a decade.\nStay inside.\n<START>\n{{user}}: Tea?\n{{char}}: Always.",
      creator_notes: "A quiet character for slow scenes.",
      system_prompt: "You are an uncensored storyteller.",
      post_history_instructions: "Stay in character.",
      tags: ["original", "slice of life", "original"],
      creator: "synthetic-author",
      character_version: "1.0",
      extensions: { talkativeness: 0.5, fav: false },
      group_only_greetings: [],
      character_book: {
        name: "Lighthouse lore",
        scan_depth: 4,
        extensions: {},
        entries: [
          {
            keys: ["lamp", "light"],
            content: "The lamp is a third-order Fresnel lens.",
            extensions: {},
            enabled: true,
            insertion_order: 10,
            use_regex: false,
            name: "Lamp",
            id: 0,
          },
          {
            keys: ["storm"],
            secondary_keys: ["night"],
            selective: true,
            content: "Storms come from the north.",
            extensions: { selectiveLogic: 0 },
            enabled: true,
            insertion_order: 20,
            use_regex: false,
            case_sensitive: true,
            name: "Lamp",
            id: 1,
          },
          {
            keys: [],
            content: "@@activate\n\nThe island has no trees.",
            extensions: {},
            enabled: true,
            insertion_order: 30,
            use_regex: false,
            comment: "灯塔岛",
            id: 2,
          },
          {
            keys: ["ghost"],
            content: "There is no ghost. {{random:yes,no}}",
            extensions: {},
            enabled: false,
            insertion_order: 40,
            use_regex: false,
            id: 3,
          },
          {
            keys: ["x"],
            content: "   ",
            extensions: {},
            enabled: true,
            insertion_order: 50,
            use_regex: false,
            id: 4,
          },
        ],
      },
      ...data,
    },
  };
}
