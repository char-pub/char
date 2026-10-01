/** Actual role messages from indirect and cross-Scenario instances in all three runtimes. */
import { assemble, startSession } from "@char-pub/assembler";
import {
  buildCreation,
  type CreationInput,
  canonicalizeCreation,
  PRESET_REGIONS,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";

function fixture(nested: boolean, draft = false) {
  const id = (prefix: string, n: number) =>
    `${prefix}_01h455vb4pex5vsknk084sn0${n.toString().padStart(2, "0")}`;
  const meta = {
    default_locale: "en",
    rating: "general",
    rights: "original",
    license: "CC0-1.0",
  } as const;
  const creations: CreationInput[] = [
    {
      id: id("cr", 1),
      ref: "@roles/voice",
      type: "style",
      display_name: "Voice",
      meta,
      fragments: [
        {
          id: "voice",
          stable: true,
          kind: "style",
          content: { type: "text", text: "Speak quietly." },
        },
      ],
    },
    {
      id: id("cr", 2),
      ref: "@roles/guard",
      type: "character",
      display_name: "Guard",
      meta,
      references: [{ id: "voice", use: "@roles/voice", mode: "intrinsic" }],
      fragments: [
        {
          id: "identity",
          stable: true,
          kind: "character",
          content: { type: "text", text: "I guard the inn." },
        },
        {
          id: "secret",
          stable: true,
          kind: "knowledge",
          visibility: { scope: "private", to: ["{{self}}"] },
          content: { type: "text", text: "ORIGINAL_PRIVATE" },
        },
      ],
    },
    {
      id: id("cr", 3),
      ref: "@roles/world",
      type: "world",
      display_name: "World",
      meta,
      references: [{ id: "guard", use: "@roles/guard", mode: "default" }],
      fragments: [
        {
          id: "world",
          stable: true,
          kind: "world",
          content: { type: "text", text: "The inn is closed." },
        },
      ],
    },
    {
      id: id("cr", 4),
      ref: "@roles/nested",
      type: "scenario",
      display_name: "Nested",
      meta,
      references: [{ id: "world", use: "@roles/world", mode: "default" }],
      cast: [{ key: "front", who: "@roles/guard" }],
    },
    {
      id: id("cr", 5),
      ref: "@roles/story",
      type: "scenario",
      display_name: "Story",
      meta,
      references: [
        { id: "setting", use: nested ? "@roles/nested" : "@roles/world", mode: "default" },
      ],
      cast: ["front", "back"].map((key) => ({
        key,
        who: "@roles/guard",
        override: [
          {
            op: "replace",
            target: "secret",
            content: { type: "text", text: `${key.toUpperCase()}_PRIVATE` },
          },
        ],
      })),
      story: { version: 1, scenes: [{ id: "inn", title: "Inn", cast: ["front", "back"] }] },
    },
    {
      id: id("cr", 6),
      ref: "@roles/preset",
      type: "preset",
      display_name: "Preset",
      meta,
      policy: {
        version: "1-draft",
        blocks: [],
        layout: [...PRESET_REGIONS],
        requires: { system_role: true },
      },
    },
  ];
  const releases = creations.map((creation, i) => {
    for (const edge of creation.references ?? []) {
      const target = creations.findIndex((c) => c.ref === edge.use);
      edge.pin = {
        release: id("rel", target + 1),
        semantic_digest: canonicalizeCreation(creations[target]).semantic_digest,
      };
    }
    return {
      creation,
      release: id("rel", i + 1),
      visibility: "public" as const,
      semantic_digest: canonicalizeCreation(creation).semantic_digest,
    };
  });
  const root = releases[4];
  const policy = releases[5];
  if (!root || !policy) throw new Error("Missing fixture");
  const build = () =>
    buildCreation({
      root: draft
        ? {
            creation: root.creation,
            semantic_digest: root.semantic_digest,
            visibility: "private",
            origin: {
              kind: "draft-build",
              build_id: id("dbld", 5),
              revision: id("rev", 5),
              expires_at: "2026-10-07T00:00:00.000Z",
            },
          }
        : root,
      dependencies: releases.filter((item) => item !== root),
      default_policy: {
        ref: policy.creation.ref,
        release: policy.release,
        semantic_digest: policy.semantic_digest,
      },
    });
  const artifact = build().artifact;
  if (artifact.kind !== "content") throw new Error("Missing content");
  return { artifact, build };
}

describe("indirect role context across runtimes", () => {
  it.each([
    { nested: false, draft: false },
    { nested: true, draft: false },
    { nested: true, draft: true },
  ])(
    "preserves role ownership in actual model messages (nested=$nested, draft=$draft)",
    ({ nested, draft }) => {
      const { artifact, build } = fixture(nested, draft);
      if (draft) {
        expect(artifact.root).not.toHaveProperty("release");
        expect(artifact.root).toMatchObject({ origin: { kind: "draft-build" } });
        expect(artifact.ir.root).toEqual(artifact.root);
        expect(
          artifact.ir.graph.nodes.find((node) => node.ref === artifact.root.ref),
        ).toMatchObject({ origin: { kind: "draft-build" } });
      }
      const { turn } = startSession({
        artifact,
        bindings: { user: { kind: "persona", display_name: "Player" } },
      });
      const profile = {
        runtime: { name: "fixture", version: "1" },
        tokenizer: "estimate",
        context_window: 10000,
        reserve_for_output: 0,
        mode: "per-agent" as const,
        capabilities: { system_role: true, multiple_system_messages: true },
      };
      for (const key of ["front", "back"]) {
        const result = assemble({ artifact, profile, turn: { ...turn, for_participant: key } });
        const text = result.messages.map((m) => m.content).join("\n");
        expect(text).toContain(`${key.toUpperCase()}_PRIVATE`);
        expect(text).not.toContain(`${key === "front" ? "BACK" : "FRONT"}_PRIVATE`);
        expect(text).not.toContain("ORIGINAL_PRIVATE");
        expect(text.match(/Speak quietly\./g)).toHaveLength(1);
        const own = artifact.ir.graph.instances.find(
          (i) => i.cast?.scope === "root" && i.cast.key === key,
        );
        const secret = artifact.ir.fragments.find(
          (f) => f.origin.instance_key === own?.key && f.origin.fragment === "secret",
        );
        expect(result.messages.flatMap((m) => m.source)).toContain(secret?.id);
      }
      expect(build().artifact).toEqual(artifact);
    },
  );
});
