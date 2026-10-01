import { z } from "zod";
import { CharError, compareStrings } from "./errors.js";
import type { CreationArtifact } from "./schema/artifact.js";
import { CapabilitiesSchema, type Capability } from "./schema/capabilities.js";
import type { StoryCondition, StoryEffect } from "./schema/story.js";

/** Infer requirements from emitted content and selected policy, never unused input snapshots. */
export function deriveCapabilities(artifact: CreationArtifact): Capability[] {
  const required = new Map<string, Capability>();
  const add = (id: string, experimental = false) =>
    required.set(id, { id, ...(experimental ? { experimental: true as const } : {}) });
  if (artifact.kind !== "content") return [{ id: "policy.1-draft" }];
  if (artifact.assembly || artifact.default_policy) add("policy.1-draft");
  const { ir, catalog_index: catalog, story } = artifact;
  if (
    catalog.groups.length ||
    catalog.about?.length ||
    catalog.works.some((work) => work.description !== undefined) ||
    ir.fragments.some(
      (fragment) => fragment.description !== undefined || fragment.selectable !== undefined,
    )
  )
    add("catalog.v1");
  if (catalog.sources.length) add("sources.v1");
  for (const fragment of ir.fragments) {
    if (fragment.perspective !== undefined && fragment.perspective !== "canon")
      add("perspective.v1");
    if (fragment.outward === true) add("view.outward");
    if (
      (fragment.style_scope !== undefined && fragment.style_scope !== "narration") ||
      fragment.style_use?.combine === "replace" ||
      fragment.style_use?.path?.some((use) => use.combine === "replace")
    )
      add("style.scope");
    if (fragment.origin.overridden_by?.some((origin) => origin.cast !== undefined))
      add("cast.override");
  }
  if (
    ir.graph.removed.some(
      (fragment) => fragment.by.reason === "override" && fragment.by.cast !== undefined,
    )
  )
    add("cast.override");
  if (story) {
    add("story.v1");
    if (
      Object.keys(story.vars ?? {}).length ||
      story.starts?.some((start) => start.reached?.length)
    )
      add("story.conditions", true);
    if (Object.keys(story.knowing ?? {}).length) add("story.knowing", true);
    if (story.items?.length) add("story.items", true);
    if (story.events?.length || story.timelines?.length) add("story.events", true);
    const condition = (node: StoryCondition) => {
      const pending = [node];
      while (pending.length) {
        const next = pending.pop();
        if (!next) continue;
        if ("judge" in next) add("story.judge", true);
        else {
          add("story.conditions", true);
          if ("knows" in next) add("story.knowing", true);
          if ("all" in next) pending.push(...next.all);
          else if ("any" in next) pending.push(...next.any);
          else if ("not" in next) pending.push(next.not);
        }
      }
    };
    const effect = (nodes: readonly StoryEffect[]) => {
      if (nodes.length) add("story.conditions", true);
      if (nodes.some((node) => "learn" in node)) add("story.knowing", true);
    };
    for (const node of [
      ...story.scenes,
      ...(story.beats ?? []),
      ...(story.endings ?? []),
      ...(story.events ?? []),
      ...(story.choices ?? []),
    ]) {
      if (node.when) condition(node.when);
      if ("effects" in node && node.effects) effect(node.effects);
    }
    for (const start of story.starts ?? []) if (start.set) effect(start.set);
  }
  return [...required.values()].sort((a, b) => compareStrings(a.id, b.id));
}

export const RuntimeCapabilitySupportSchema = z
  .strictObject({
    supported: z.array(z.string().min(1)),
    /** The caller owns these degradation policies; Core only carries their explanations. */
    degraded: z
      .array(z.strictObject({ id: z.string().min(1), reason: z.string().trim().min(1) }))
      .optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set(value.supported);
    if (seen.size !== value.supported.length)
      ctx.addIssue({
        code: "custom",
        path: ["supported"],
        message: "duplicate supported capability",
      });
    for (const [index, item] of (value.degraded ?? []).entries()) {
      if (seen.has(item.id))
        ctx.addIssue({
          code: "custom",
          path: ["degraded", index, "id"],
          message: "capability already classified",
        });
      seen.add(item.id);
    }
  });
export type RuntimeCapabilitySupport = z.infer<typeof RuntimeCapabilitySupportSchema>;
export interface CapabilitySupportReport {
  status: "supported" | "degraded" | "unsupported";
  missing: Capability[];
  degraded: (Capability & { reason: string })[];
}

/** Missing requirements are unsupported, including unknown or experimental IDs. */
export function checkCapabilitySupport(
  required: readonly Capability[],
  runtime: RuntimeCapabilitySupport,
): CapabilitySupportReport {
  const parsedRequirements = CapabilitiesSchema.safeParse(required);
  const parsedRuntime = RuntimeCapabilitySupportSchema.safeParse(runtime);
  if (!parsedRequirements.success || !parsedRuntime.success)
    throw new CharError({
      code: "capability.invalid_input",
      subject: !parsedRequirements.success ? "capabilities" : "runtime",
    });
  const supported = new Set(parsedRuntime.data.supported);
  const policies = new Map(
    (parsedRuntime.data.degraded ?? []).map((item) => [item.id, item.reason]),
  );
  const missing: Capability[] = [];
  const degraded: CapabilitySupportReport["degraded"] = [];
  for (const capability of parsedRequirements.data) {
    if (supported.has(capability.id)) continue;
    const reason = policies.get(capability.id);
    if (reason !== undefined) degraded.push({ ...capability, reason });
    else missing.push(capability);
  }
  return {
    status: missing.length ? "unsupported" : degraded.length ? "degraded" : "supported",
    missing,
    degraded,
  };
}
