/**
 * Playground 与作品页使用的示例作品。它们是普通的 Canonical Creation，在浏览器里用
 * core 的 Resolver 现算出 Context IR，演示依赖、覆盖、绑定和评级汇总如何工作。
 * 所有 ID 都是合法的 TypeID，内容纯属虚构。
 */
import {
  type CreationInput,
  canonicalizeCreation,
  type ReleaseInput,
  type ResolveOutput,
  resolve,
} from "@char-pub/core";

/** 固定的示例 ID：`sampleId("cr", 1)` → `cr_01jadx00000000000000000001`。 */
export function sampleId(prefix: string, n: number): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const a = alphabet[Math.floor(n / 32) % 32] ?? "0";
  const b = alphabet[n % 32] ?? "0";
  return `${prefix}_01jadx000000000000000000${a}${b}`;
}

const DIGEST = (c: string) => `sha256:${c.repeat(64)}`;

export interface SampleRelease extends ReleaseInput {
  release: string;
  semantic_digest: string;
  label: string;
}

function release(n: number, label: string, creation: CreationInput): SampleRelease {
  return {
    release: sampleId("rel", n),
    visibility: "public",
    label,
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  };
}

const pin = (r: SampleRelease) => ({ release: r.release, semantic_digest: r.semantic_digest });

// ---------------------------------------------------------------------------
// World 与 Lorebook
// ---------------------------------------------------------------------------

function nightCity(version: 1 | 2): CreationInput {
  return {
    id: sampleId("cr", 2),
    ref: "@cyberpunk/night-city",
    type: "world",
    display_name: "Night City",
    summary: "A coastal megacity run by corporations.",
    authors: [{ name: "Cyberpunk Commons" }],
    fragments: [
      {
        id: "world",
        stable: true,
        kind: "world",
        content: {
          type: "text",
          text:
            version === 1
              ? "Night City is a coastal megacity where corporations own the police, the water and the sky."
              : "Night City is a coastal megacity where corporations own the police, the water and the sky. Since the blackout, the old districts are lit only by neon billboards.",
        },
        importance: "pinned",
      },
      {
        id: "districts",
        stable: true,
        kind: "world",
        content: {
          type: "text",
          text: "Watson is crowded, Heywood is proud, and Pacifica was abandoned mid-construction.",
        },
      },
      ...(version === 2
        ? [
            {
              id: "blackout",
              stable: true,
              kind: "knowledge" as const,
              content: {
                type: "text" as const,
                text: "The blackout of '77 erased three years of city records.",
              },
              activation: { mode: "keyword" as const, keys: ["blackout", "records"] },
            },
          ]
        : []),
    ],
    meta: {
      default_locale: "en",
      rating: version === 1 ? "teen" : "mature",
      content_warnings: version === 1 ? ["violence"] : ["violence", "drug use"],
      rights: "original",
      license: version === 1 ? "CC-BY-4.0" : "CC-BY-NC-4.0",
    },
  };
}

const corps: CreationInput = {
  id: sampleId("cr", 3),
  ref: "@cyberpunk/corps",
  type: "lorebook",
  display_name: "Corporations of Night City",
  authors: [{ name: "Cyberpunk Commons" }],
  fragments: [
    {
      id: "lore/arasaka",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "Arasaka sells security to anyone who can pay twice." },
      activation: { mode: "keyword", keys: ["Arasaka"] },
    },
    {
      id: "lore/militech",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "Militech builds the weapons Arasaka's guards carry." },
      activation: { mode: "keyword", keys: ["Militech", "weapons"] },
    },
    {
      id: "lore/biotechnica",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "Biotechnica grows the synthetic food most people eat." },
      activation: { mode: "manual" },
    },
  ],
  meta: { default_locale: "en", rating: "teen", rights: "original", license: "CC-BY-4.0" },
};

const childhoodFriend: CreationInput = {
  id: sampleId("cr", 4),
  ref: "@commons/childhood-friend",
  type: "relationship",
  display_name: "Childhood friend",
  slots: { a: { accepts: "character" }, b: { accepts: ["character", "persona"] } },
  params: { reunited_after: { type: "string", default: "several years" } },
  fragments: [
    {
      id: "bond",
      stable: true,
      kind: "relationship",
      content: {
        type: "text",
        text: "{{slot:a}} and {{slot:b}} grew up next door. They met again after {{param:reunited_after}}.",
      },
    },
  ],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
};

const AVATAR = {
  slot: "avatar",
  role: "presentation" as const,
  variants: [
    {
      id: "default",
      media_type: "image/webp",
      blob: { digest: DIGEST("a"), size: 2048, availability: "mirrored" as const },
      alt: "Alice, a courier with a scratched visor",
    },
  ],
};

// ---------------------------------------------------------------------------
// Alice 的几个版本
// ---------------------------------------------------------------------------

function alice(references: CreationInput["references"] = [], extra: Partial<CreationInput> = {}) {
  return {
    id: sampleId("cr", 1),
    ref: "@djj/alice",
    type: "character",
    display_name: { en: "Alice", ja: "アリス" },
    summary: "A courier who is always late, and always right.",
    authors: [{ name: "DJJ" }],
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: {
          type: "text",
          text: "{{self}} is a courier in her twenties. She teases {{user}} but never lies to them.",
        },
        locale: {
          ja: {
            content: {
              type: "text",
              text: "{{self}}は二十代の運び屋。{{user}}をからかうが、嘘はつかない。",
            },
          },
        },
      },
      {
        id: "secret",
        stable: true,
        kind: "character",
        content: { type: "text", text: "{{self}} is afraid of deep water." },
        visibility: { scope: "private", to: ["{{self}}"] },
      },
    ],
    references,
    bootstrap: {
      greetings: [
        {
          id: "default",
          text: "You're late again, {{user}}. Lucky for you, so is the train.",
          locale: {
            ja: { content: { type: "text", text: "また遅刻ね、{{user}}。電車も遅れてるけど。" } },
          },
        },
      ],
    },
    assets: [AVATAR],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    ...extra,
  } satisfies CreationInput;
}

export const releases = {
  nightCityV1: release(2, "1.0.0", nightCity(1)),
  nightCityV2: release(5, "2.0.0", nightCity(2)),
  corps: release(3, "1.0.0", corps),
  childhoodFriend: release(4, "1.0.0", childhoodFriend),
};

const withWorld = (world: SampleRelease) => [
  {
    id: "knows",
    rel: "knows_about",
    use: "@cyberpunk/corps",
    mode: "default" as const,
    pin: pin(releases.corps),
    override: [
      {
        op: "patch" as const,
        target: "lore/militech",
        set: { importance: "opportunistic" as const },
      },
    ],
  },
  {
    id: "lives-in",
    rel: "lives_in",
    use: "@cyberpunk/night-city",
    mode: "intrinsic" as const,
    pin: pin(world),
  },
];

export interface Sample {
  id: string;
  title: string;
  description: string;
  root: SampleRelease;
  dependencies: SampleRelease[];
}

export const samples: Sample[] = [
  {
    id: "level0",
    title: "Level 0 character",
    description: "Name, description, greeting and avatar — the smallest publishable character.",
    root: release(1, "1.0.0", alice()),
    dependencies: [],
  },
  {
    id: "world-lore",
    title: "Character + world + lorebook",
    description:
      "Alice lives in Night City (core dependency) and knows a keyword-triggered lorebook, with one entry patched.",
    root: release(10, "1.1.0", alice(withWorld(releases.nightCityV1))),
    dependencies: [releases.nightCityV1, releases.corps],
  },
  {
    id: "relationship",
    title: "Relationship template",
    description: "A reusable relationship bound early to Alice and late to whoever plays the user.",
    root: release(
      11,
      "1.2.0",
      alice([
        {
          id: "friend",
          rel: "relationship",
          use: "@commons/childhood-friend",
          mode: "default",
          pin: pin(releases.childhoodFriend),
          bind: { a: "{{self}}", b: { late: "persona", hint: "the user" } },
          params: { reunited_after: "ten years" },
        },
      ]),
    ),
    dependencies: [releases.childhoodFriend],
  },
];

/** Diff 演示：Night City 从 1.0.0 升级到 2.0.0 前后的 Alice。 */
export const diffPair = {
  from: {
    title: "Alice 1.1.0 · Night City 1.0.0",
    root: release(10, "1.1.0", alice(withWorld(releases.nightCityV1))),
    dependencies: [releases.nightCityV1, releases.corps],
  },
  to: {
    title: "Alice 1.2.0 · Night City 2.0.0",
    root: release(12, "1.2.0", alice(withWorld(releases.nightCityV2))),
    dependencies: [releases.nightCityV2, releases.corps],
  },
};

export function resolveSample(s: Pick<Sample, "root" | "dependencies">): ResolveOutput {
  return resolve({
    root: s.root,
    dependencies: s.dependencies,
    publicAssetBaseUrl: "https://assets.char.pub/cas/sha256",
  });
}

/** 依赖闭包里每个 Release 的 label，供 Diff 展示。 */
export function locksOf(s: Pick<Sample, "dependencies">) {
  return s.dependencies.map((d) => ({
    ref: canonicalizeCreation(d.creation).creation.ref,
    release: d.release,
    label: d.label,
  }));
}
