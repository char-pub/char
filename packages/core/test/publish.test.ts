import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkPublish, type PublishInput } from "../src/publish.js";
import type { ReleaseInput } from "../src/resolve/index.js";
import type { CreationInput } from "../src/schema/creation.js";
import { D, level0Character, tid } from "./fixtures.js";

// biome-ignore lint/suspicious/noExplicitAny: 反例输入不需要满足类型
type Loose = any;

function dep(n: number, creation: CreationInput, extra: Partial<ReleaseInput> = {}) {
  return {
    release: tid("rel", n),
    visibility: "public" as const,
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
    ...extra,
  };
}
const pinOf = (r: { release: string; semantic_digest: string }) => ({
  release: r.release,
  semantic_digest: r.semantic_digest,
});

const world: CreationInput = {
  id: tid("cr", 2),
  ref: "@cyberpunk/night-city",
  type: "world",
  display_name: "Night City",
  fragments: [
    { id: "world", stable: true, kind: "world", content: { type: "text", text: "A megacity." } },
    { id: "temp", stable: false, kind: "knowledge", content: { type: "text", text: "Imported." } },
  ],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
};

const READY = { [D("a")]: "ready" } as const;

function input(over: Partial<PublishInput> & { creation?: unknown } = {}): PublishInput {
  return {
    release: tid("rel", 1),
    label: "1.0.0",
    visibility: "public",
    creation: level0Character(),
    dependencies: [],
    registry: {
      existingLabels: {},
      assetStatus: READY,
      blockedDigests: new Set(),
      ownerNamespaces: new Set(["djj"]),
    },
    ...over,
  };
}

function withRegistry(over: Partial<PublishInput["registry"]>): Partial<PublishInput> {
  return { registry: { ...input().registry, ...over } };
}

const codes = (i: PublishInput) =>
  checkPublish(i)
    .issues.filter((x) => x.severity === "error")
    .map((x) => x.code);

describe("publish checks: happy path", () => {
  it("accepts a Level 0 character and returns the resolved IR", () => {
    const r = checkPublish(input());
    expect(r.ok).toBe(true);
    expect(r.license_check).toBe("pass");
    expect(r.resolved?.ir.root.ref).toBe("@djj/alice");
  });

  it("accepts a character with a pinned public dependency", () => {
    const w = dep(2, world);
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w) },
      ],
    });
    expect(checkPublish(input({ creation: c, dependencies: [w] })).ok).toBe(true);
  });
});

describe("publish checks: one counter-example per rule", () => {
  it("1. rejects follow: latest", () => {
    const c = level0Character({
      references: [
        {
          id: "lives-in",
          use: "@cyberpunk/night-city",
          mode: "intrinsic",
          pin: { follow: "latest" },
        },
      ],
    });
    expect(codes(input({ creation: c }))).toContain("publish.unpinned");
  });

  it("2. rejects a tombstoned dependency and warns on a yanked one", () => {
    const t = dep(2, world, { status: "tombstoned", status_reason: "DMCA" });
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(t) },
      ],
    });
    const r = checkPublish(input({ creation: c, dependencies: [t] }));
    expect(r.issues[0]).toMatchObject({ code: "publish.tombstoned_dependency", detail: "DMCA" });

    const y = dep(2, world, { status: "yanked" });
    const ry = checkPublish(input({ creation: c, dependencies: [y] }));
    expect(ry.ok).toBe(true);
    expect(ry.issues.map((i) => i.code)).toContain("publish.yanked_dependency");
  });

  it("3. rejects a public release that depends on a private one", () => {
    const p = dep(2, world, { visibility: "private" });
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(p) },
      ],
    });
    expect(codes(input({ creation: c, dependencies: [p] }))).toEqual([
      "publish.public_depends_on_private",
    ]);
    expect(checkPublish(input({ creation: c, dependencies: [p], visibility: "private" })).ok).toBe(
      true,
    );
  });

  it("4. rejects two releases of the same creation (diamond) with both paths", () => {
    const w1 = dep(2, world);
    const w2 = dep(3, { ...world, summary: "v2" });
    const lore: CreationInput = {
      id: tid("cr", 4),
      ref: "@cyberpunk/corps",
      type: "lorebook",
      display_name: "Corps",
      fragments: [
        { id: "a", stable: true, kind: "knowledge", content: { type: "text", text: "x" } },
      ],
      references: [
        { id: "setting", use: "@cyberpunk/night-city", mode: "default", pin: pinOf(w2) },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    };
    const l = dep(4, lore);
    const c = level0Character({
      references: [
        { id: "a", use: "@cyberpunk/corps", mode: "default", pin: pinOf(l) },
        { id: "b", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w1) },
      ],
    });
    const r = checkPublish(input({ creation: c, dependencies: [w1, w2, l] }));
    expect(r.issues[0]?.code).toBe("publish.diamond_conflict");
    expect(r.issues[0]?.data).toMatchObject({ ref: "@cyberpunk/night-city" });
  });

  it("5. rejects an override of an unstable fragment", () => {
    const w = dep(2, world);
    const c = level0Character({
      references: [
        {
          id: "lives-in",
          use: "@cyberpunk/night-city",
          mode: "default",
          pin: pinOf(w),
          override: [{ op: "remove", target: "temp" }],
        },
      ],
    });
    expect(codes(input({ creation: c, dependencies: [w] }))).toEqual([
      "check.override_target_unstable",
    ]);
  });

  it("6. rejects a missing required slot", () => {
    const rel: CreationInput = {
      id: tid("cr", 5),
      ref: "@commons/rivals",
      type: "relationship",
      display_name: "Rivals",
      slots: { a: { accepts: "character" }, b: { accepts: "character" } },
      fragments: [
        {
          id: "bond",
          stable: true,
          kind: "relationship",
          content: { type: "text", text: "{{slot:a}} vs {{slot:b}}" },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    };
    const r = dep(5, rel);
    const c = level0Character({
      references: [
        {
          id: "rival",
          use: "@commons/rivals",
          mode: "default",
          pin: pinOf(r),
          bind: { a: "{{self}}" },
        },
      ],
    });
    expect(codes(input({ creation: c, dependencies: [r] }))).toEqual([
      "check.required_slot_unbound",
    ]);
  });

  it("7. rejects an asset that is not ready", () => {
    expect(codes(input(withRegistry({ assetStatus: { [D("a")]: "processing" } })))).toEqual([
      "publish.asset_not_ready",
    ]);
    expect(codes(input(withRegistry({ assetStatus: {} })))).toEqual(["publish.asset_not_ready"]);
  });

  it("8. rejects content char.pub cannot redistribute, and a dependency it cannot build on", () => {
    const arr = level0Character({
      ref: "@someone/alice",
      meta: {
        default_locale: "en",
        rating: "general",
        rights: "original",
        license: "LicenseRef-All-Rights-Reserved",
      },
    });
    expect(codes(input({ creation: arr }))).toContain("license.not_redistributable");
    // 权利人本人发布自己的保留权利作品是允许的。
    expect(checkPublish(input({ creation: { ...arr, ref: "@djj/alice" } })).ok).toBe(true);

    const w = dep(2, {
      ...world,
      meta: { ...world.meta, license: "LicenseRef-All-Rights-Reserved" },
    });
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w) },
      ],
    });
    const r = checkPublish(input({ creation: c, dependencies: [w] }));
    expect(r.ok).toBe(false);
    expect(r.license_check).toBe("fail");
  });

  it("8b. warns when a non-commercial dependency is combined with a commercial license", () => {
    const w = dep(2, { ...world, meta: { ...world.meta, license: "CC-BY-NC-4.0" } });
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w) },
      ],
    });
    const r = checkPublish(input({ creation: c, dependencies: [w] }));
    expect(r.ok).toBe(true);
    expect(r.license_check).toBe("warn");
  });

  it("9. rejects a taken label with different content, and is idempotent for the same content", () => {
    const same = canonicalizeCreation(level0Character()).semantic_digest;
    const r = checkPublish(input(withRegistry({ existingLabels: { "1.0.0": same } })));
    expect(r).toMatchObject({ ok: true, idempotent: true });
    expect(codes(input(withRegistry({ existingLabels: { "1.0.0": D("f") } })))).toEqual([
      "publish.label_taken",
    ]);
  });

  it("rejects blocked content even under a new name", () => {
    const frag = canonicalizeCreation(level0Character()).creation.fragments[0];
    const blocked = new Set([frag?.digest ?? ""]);
    const renamed = level0Character({ ref: "@djj/alice-2" });
    expect(
      codes(input({ creation: renamed, ...withRegistry({ blockedDigests: blocked }) })),
    ).toEqual(["publish.blocked_content"]);
    expect(codes(input(withRegistry({ blockedDigests: new Set([D("a")]) })))).toContain(
      "publish.blocked_content",
    );
  });

  it("reports schema errors instead of throwing", () => {
    const r = checkPublish(input({ creation: { nope: true } as Loose }));
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe("schema.invalid");
  });

  it("reports local check errors such as unknown placeholders", () => {
    const c = level0Character({
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{char}} hi" },
        },
      ],
    });
    expect(codes(input({ creation: c }))).toContain("check.unknown_placeholder");
  });
});
