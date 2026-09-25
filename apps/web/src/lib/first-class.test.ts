import {
  buildCreation,
  type ContextIR,
  canonicalizeCreation,
  digestOf,
  mergeContribution,
  PRESET_REGIONS,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/render";
import { loadAssemblyInput } from "./assembly-input";
import { buildChanges, contributionBase } from "./contribution";
import { bindingsFor, DEFAULT_SETTINGS, runPreview } from "./preview";

const meta = { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" };
const policy = {
  version: "0-draft",
  blocks: [{ id: "rules", text: "Speak clearly.", position: "main" }],
  layout: [...PRESET_REGIONS],
  requires: { system_role: true },
};
const preset = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/policy",
  type: "preset",
  display_name: "Policy",
  policy,
  meta,
};
function scenarioIR(): ContextIR {
  const { artifact } = buildCreation({
    root: {
      release: "rel_01j00000000000000000000000",
      visibility: "public",
      creation: {
        id: "cr_01j00000000000000000000001",
        ref: "@writer/scene",
        type: "scenario",
        display_name: "Scene",
        meta,
        cast: [
          { key: "left", who: { late: "persona" } },
          { key: "right", who: { late: "character" } },
        ],
        fragments: [
          {
            id: "scene",
            stable: true,
            kind: "scenario",
            content: { type: "text", text: "A secret room." },
          },
        ],
      },
    },
  });
  if (artifact.kind !== "content") throw new Error("content expected");
  return artifact.ir;
}
describe("first-class authoring", () => {
  it("keeps runtime roles independent and forwards the selected per-agent perspective", () => {
    const ir = scenarioIR();
    const named = ir.late_slots.filter((slot) => slot.key !== "user");
    expect(named).toHaveLength(2);
    expect(bindingsFor(ir, DEFAULT_SETTINGS.persona)).not.toHaveProperty(
      named[0]?.key ?? "missing",
    );
    const lateBindings = Object.fromEntries(
      named.map((slot, i) => [
        slot.key,
        { name: i ? "Right" : "Left", description: "", kind: slot.accepts[0] ?? "persona" },
      ]),
    );
    const participant = ir.participants.find((p) => p.key !== "user");
    const fragment = ir.fragments[0];
    if (!participant || !fragment) throw new Error("missing test fixture");
    fragment.visibility = { scope: "private", to: [`participant:${participant.key}`] };
    const own = runPreview(ir, {
      ...DEFAULT_SETTINGS,
      mode: "per-agent",
      forParticipant: participant.key,
      lateBindings,
    });
    expect(own.ok).toBe(true);
    if (own.ok)
      expect(own.result.messages.some((m) => m.content.includes("A secret room."))).toBe(true);
    const other = ir.participants.find((p) => p.key !== participant.key && p.key !== "user");
    if (!other) throw new Error("missing participant");
    const hidden = runPreview(ir, {
      ...DEFAULT_SETTINGS,
      mode: "per-agent",
      forParticipant: other.key,
      lateBindings,
    });
    expect(hidden.ok).toBe(true);
    if (hidden.ok)
      expect(hidden.result.messages.some((m) => m.content.includes("A secret room."))).toBe(false);
  });
  it("submits policy changes as a mergeable configuration with a base digest", () => {
    const base = contributionBase(preset);
    const changed = { ...policy, blocks: [{ ...policy.blocks[0], text: "Updated policy." }] };
    const changes = buildChanges(base.canonical, {
      ...base.edit,
      configuration: { ...base.edit.configuration, policy: changed },
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      on: "configuration",
      field: "policy",
      op: "set",
      base_digest: digestOf((base.canonical.json as Record<string, unknown>).policy),
    });
    expect(changes[0]).not.toHaveProperty("sensitive");
    const merged = mergeContribution(base.canonical.creation, changes);
    expect(merged.conflicts).toEqual([]);
    expect(merged.result?.creation.policy?.blocks[0]?.text).toBe("Updated policy.");
  });
  it("loads module references and preserves yanked release status", async () => {
    const module = {
      ...preset,
      id: "cr_01j00000000000000000000002",
      ref: "@writer/module",
      type: "prompt-module",
      policy: undefined,
      prompt_module: { version: "0-draft", blocks: policy.blocks },
    };
    const canonical = canonicalizeCreation(module);
    const release = "rel_01j00000000000000000000002";
    const input = await loadAssemblyInput(
      fakeClient({
        creation: async (ns, name) => {
          expect([ns, name]).toEqual(["writer", "module"]);
          return {
            releases: [{ id: release, label: "1.0.0", visibility: "public", status: "yanked" }],
          } as never;
        },
        releaseSource: async () => ({ creation: module }) as never,
      }),
      {
        ...preset,
        policy: {
          ...policy,
          imports: [
            {
              id: "module",
              use: "@writer/module",
              pin: { release, semantic_digest: canonical.semantic_digest },
            },
          ],
        },
      },
    );
    expect(input.dependencies?.[0]).toMatchObject({
      status: "yanked",
      semantic_digest: canonical.semantic_digest,
    });
  });
});
