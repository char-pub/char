import {
  buildIdentity,
  type CreationArtifact,
  digestExactJSON,
  lateSlotKey,
  MAX_RUNTIME_PREVIEW_BYTES,
  type RuntimePreviewInput,
  RuntimePreviewInputSchema,
} from "@char-pub/core";
import { expect, it, vi } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { tid } from "../../core/test/fixtures.js";
import { initialStoryTurn, TOKENIZER_VERSIONS, validateRuntimePreviewInput } from "../src/index.js";

function fixture(draft = false) {
  const creation = {
    id: tid("cr", 201),
    ref: "@test/runtime-preview",
    type: "scenario",
    display_name: "Runtime preview",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "host", who: { late: "character" } }],
    fragments: [
      { id: "secret", kind: "knowledge", stable: true, content: { type: "text", text: "Secret" } },
    ],
    story: {
      version: 1,
      scenes: [{ id: "room", title: "Room", opening: "Hello {{cast:host}}", lore: ["#guide"] }],
      vars: { ready: { type: "bool", init: false, description: "Ready" } },
      knowing: { "#secret": { start: { knows: ["host"] } } },
    },
    sources: [
      {
        id: "guide",
        title: "Guide",
        description: "Guide description",
        asset: "guide",
        format: "text",
      },
    ],
    assets: [
      {
        slot: "guide",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: {
              digest: `sha256:${"a".repeat(64)}`,
              size: 100,
              availability: "mirrored",
            },
          },
        ],
      },
    ],
  };
  const { artifact } = buildTestCreation({
    root: draft
      ? {
          creation,
          visibility: "private",
          origin: {
            kind: "draft-build",
            build_id: tid("dbld", 201),
            revision: tid("rev", 201),
            expires_at: "2000-01-01T00:00:00.000Z",
          },
        }
      : { creation, visibility: "public", release: tid("rel", 201) },
  });
  if (artifact.kind !== "content" || !artifact.default_policy) throw new Error("Content required");
  const initial = initialStoryTurn(artifact);
  const preset = artifact.default_policy;
  const payload = RuntimePreviewInputSchema.parse({
    format: "char.pub/runtime-preview",
    version: 1,
    source: {
      root: artifact.root,
      lock_digest: artifact.lock_digest,
      artifact_json_digest: digestExactJSON(artifact),
    },
    profile: {
      runtime: { name: "synthetic", version: "1" },
      mode: "narrator",
      tokenizer: "estimate",
      locale: "en",
      context_window: 1,
      reserve_for_output: 0,
      capabilities: { system_role: true },
    },
    preset: { ref: preset.ref, semantic_digest: preset.semantic_digest, ...buildIdentity(preset) },
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    turn: {
      locale: "en",
      bindings: {
        user: { kind: "persona", display_name: "Synthetic player" },
        [lateSlotKey("root", "host")]: { kind: "character", display_name: "Synthetic host" },
      },
      history: [{ role: "user", text: "Synthetic e\u0301\r\nexample  " }],
      scene: initial.scene,
      present: initial.present,
      story: initial.story,
    },
  });
  return { artifact, payload };
}
const error = (code: string) => expect.objectContaining({ code });

it("validates a detached exact snapshot without loading required Source bodies or proving token fit", () => {
  const { artifact, payload } = fixture();
  const before = structuredClone({ artifact, payload });
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected IO"));
  try {
    const parsed = validateRuntimePreviewInput(artifact, payload);
    expect(parsed).toEqual(payload);
    expect(parsed).not.toBe(payload);
    expect(parsed.turn.history).not.toBe(payload.turn.history);
    expect(parsed.turn.history[0]?.text).toBe("Synthetic e\u0301\r\nexample  ");
    expect({ artifact, payload }).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

it.each(["root", "lock_digest", "artifact_json_digest"] as const)(
  "rejects a changed source %s",
  (field) => {
    const { artifact, payload } = fixture();
    if (field === "root") payload.source.root.semantic_digest = `sha256:${"b".repeat(64)}`;
    else payload.source[field] = `sha256:${"b".repeat(64)}`;
    expect(() => validateRuntimePreviewInput(artifact, payload)).toThrowError(
      error("runtime_preview.source_mismatch"),
    );
  },
);

it("binds the full draft identity without using a clock or silently rebasing to a newer build", () => {
  const { artifact, payload } = fixture(true);
  expect(validateRuntimePreviewInput(artifact, payload)).toEqual(payload);
  if (!("origin" in payload.source.root) || payload.source.root.origin.kind !== "draft-build")
    throw new Error("Draft required");
  for (const field of ["build_id", "revision", "expires_at"] as const) {
    const changed = structuredClone(payload);
    if (!("origin" in changed.source.root) || changed.source.root.origin.kind !== "draft-build")
      throw new Error("Draft required");
    changed.source.root.origin[field] =
      field === "expires_at"
        ? "2001-01-01T00:00:00.000Z"
        : tid(field === "build_id" ? "dbld" : "rev", 202);
    expect(() => validateRuntimePreviewInput(artifact, changed)).toThrowError(
      error("runtime_preview.source_mismatch"),
    );
  }
});

it("rejects a different preset and a changed artifact even if its root and lock remain unchanged", () => {
  const { artifact, payload } = fixture();
  const otherPreset = structuredClone(payload);
  otherPreset.preset.ref = "@test/another-policy";
  expect(() => validateRuntimePreviewInput(artifact, otherPreset)).toThrowError(
    error("runtime_preview.preset_mismatch"),
  );
  const changed = structuredClone(artifact);
  const scene = changed.story?.scenes[0];
  if (!scene) throw new Error("Scene required");
  scene.title = "Different room";
  expect(() => validateRuntimePreviewInput(changed, payload)).toThrowError(
    error("runtime_preview.source_mismatch"),
  );
});

it.each(["reviewed", "approved", "source_texts", "plan", "selection"])(
  "rejects extra top-level %s",
  (key) => {
    const { artifact, payload } = fixture();
    expect(() => validateRuntimePreviewInput(artifact, { ...payload, [key]: true })).toThrowError(
      error("runtime_preview.invalid_input"),
    );
  },
);
it.each(["overlay", "visible_overlay", "focus", "manual_enabled", "judgments"])(
  "rejects unapproved TurnView field %s",
  (key) => {
    const { artifact, payload } = fixture();
    expect(() =>
      validateRuntimePreviewInput(artifact, { ...payload, turn: { ...payload.turn, [key]: {} } }),
    ).toThrowError(error("runtime_preview.invalid_input"));
  },
);
it.each(["locale", "bindings", "history", "scene", "present", "story"])(
  "requires explicit turn.%s rather than filling session defaults",
  (key) => {
    const { artifact, payload } = fixture();
    const turn: Record<string, unknown> = { ...payload.turn };
    delete turn[key];
    expect(() => validateRuntimePreviewInput(artifact, { ...payload, turn })).toThrowError(
      error("runtime_preview.invalid_input"),
    );
  },
);

it("checks required binding kinds, unknown slot keys and exact participant speakers", () => {
  const { artifact, payload } = fixture();
  const missing = structuredClone(payload);
  delete missing.turn.bindings[lateSlotKey("root", "host")];
  expect(() => validateRuntimePreviewInput(artifact, missing)).toThrowError(
    error("assemble.late_slot_unbound"),
  );
  const wrongKind = structuredClone(payload);
  wrongKind.turn.bindings[lateSlotKey("root", "host")] = {
    kind: "persona",
    display_name: "Wrong kind",
  };
  expect(() => validateRuntimePreviewInput(artifact, wrongKind)).toThrowError(
    error("assemble.late_slot_kind_mismatch"),
  );
  const unknown = structuredClone(payload);
  unknown.turn.bindings.missing = { kind: "persona", display_name: "Unknown" };
  expect(() => validateRuntimePreviewInput(artifact, unknown)).toThrowError(
    error("runtime_preview.unknown_binding"),
  );
  const message = payload.turn.history[0];
  const host = artifact.story_refs?.participants.host;
  if (!message || !host) throw new Error("Message and host required");
  message.speaker = "missing";
  expect(() => validateRuntimePreviewInput(artifact, payload)).toThrowError(
    error("runtime_preview.unknown_speaker"),
  );
  message.speaker = host;
  expect(validateRuntimePreviewInput(artifact, payload).turn.history[0]?.speaker).toBe(host);
});

it.each(["vars", "knowing"] as const)("rejects incomplete Story %s", (field) => {
  const { artifact, payload } = fixture();
  payload.turn.story[field] = {};
  expect(() => validateRuntimePreviewInput(artifact, payload)).toThrowError(
    error("story.invalid_state"),
  );
});
it("checks current scene, presence, stopped consistency and the per-agent view", () => {
  const { artifact, payload } = fixture();
  const invalid: RuntimePreviewInput[] = [
    { ...payload, turn: { ...payload.turn, scene: "missing" } },
    { ...payload, turn: { ...payload.turn, present: ["missing"] } },
    { ...payload, turn: { ...payload.turn, story: { ...payload.turn.story, stopped: true } } },
    {
      ...payload,
      profile: { ...payload.profile, mode: "per-agent" },
      turn: { ...payload.turn, for_participant: "missing" },
    },
  ];
  for (const value of invalid) expect(() => validateRuntimePreviewInput(artifact, value)).toThrow();
  expect(
    validateRuntimePreviewInput(artifact, {
      ...payload,
      profile: { ...payload.profile, mode: "per-agent" },
      turn: { ...payload.turn, for_participant: "host" },
    }),
  ).toBeTruthy();
});

it("checks tokenizer support, version and explicit locale agreement without loading an encoder", () => {
  const { artifact, payload } = fixture();
  for (const tokenizer of [
    { name: "unknown", version: "1" },
    { name: "estimate", version: "unknown" },
  ])
    expect(() => validateRuntimePreviewInput(artifact, { ...payload, tokenizer })).toThrowError(
      error("runtime_preview.tokenizer_unsupported"),
    );
  expect(() =>
    validateRuntimePreviewInput(artifact, {
      ...payload,
      profile: { ...payload.profile, tokenizer: "cl100k_base" },
    }),
  ).toThrowError(error("runtime_preview.tokenizer_mismatch"));
  for (const locale of [undefined, "zh-CN"])
    expect(() =>
      validateRuntimePreviewInput(artifact, {
        ...payload,
        profile: { ...payload.profile, locale },
      }),
    ).toThrowError(error("runtime_preview.locale_mismatch"));
  expect(
    validateRuntimePreviewInput(artifact, {
      ...payload,
      profile: { ...payload.profile, tokenizer: "cl100k_base" },
      tokenizer: { name: "cl100k_base", version: TOKENIZER_VERSIONS.cl100k_base },
    }),
  ).toBeTruthy();
});

it("enforces the UTF-8 byte limit and rejects non-JSON data", () => {
  const { artifact, payload } = fixture();
  const large = structuredClone(payload);
  large.turn.history = [
    { role: "user", text: "界".repeat(Math.floor(MAX_RUNTIME_PREVIEW_BYTES / 3)) },
  ];
  expect(JSON.stringify(large).length).toBeLessThan(MAX_RUNTIME_PREVIEW_BYTES);
  expect(() => validateRuntimePreviewInput(artifact, large)).toThrowError(
    error("runtime_preview.too_large"),
  );
  const cyclic: Record<string, unknown> = { ...payload };
  cyclic.self = cyclic;
  for (const value of [
    undefined,
    1n,
    cyclic,
    {
      ...payload,
      turn: { ...payload.turn, story: { ...payload.turn.story, vars: { ready: Number.NaN } } },
    },
    { ...payload, profile: new Date() },
  ])
    expect(() => validateRuntimePreviewInput(artifact, value)).toThrowError(
      error("runtime_preview.invalid_input"),
    );
});

it("requires a Story content artifact", () => {
  const { artifact, payload } = fixture();
  const without = structuredClone(artifact) as CreationArtifact;
  if (without.kind !== "content") throw new Error("Content required");
  delete without.story;
  delete without.story_refs;
  expect(() => validateRuntimePreviewInput(without, payload)).toThrowError(
    error("runtime_preview.story_required"),
  );
});
