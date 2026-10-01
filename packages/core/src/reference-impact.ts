/** Static published-object use, distinct from runtime selection and from closure membership indexes. */
import { z } from "zod";
import type { CanonicalCreation } from "./canonical.js";
import { resolveCatalogReference } from "./catalog-index.js";
import { matchesFragmentPattern } from "./check.js";
import { CharError, compareStrings } from "./errors.js";
import { resolveUseRef } from "./resolve/graph.js";
import type { CreationArtifact } from "./schema/artifact.js";
import type { AboutTarget, CatalogRef } from "./schema/catalog.js";
import type { ExactRef } from "./schema/identity.js";
import type { StoryCondition } from "./schema/story.js";

export const CreationObjectAddressSchema = z.strictObject({
  kind: z.enum([
    "fragment",
    "group",
    "source",
    "section",
    "cast",
    "scene",
    "beat",
    "ending",
    "choice",
    "event",
    "item",
    "plotline",
    "timeline",
    "start",
    "variable",
    "block",
    "asset",
    "slot",
    "param",
  ]),
  id: z.string().min(1),
  parent: z.string().min(1).optional(),
});
export type CreationObjectAddress = z.infer<typeof CreationObjectAddressSchema>;
export interface PublishedObjectUse {
  object: CreationObjectAddress;
  kind: "included" | "explicit";
  path: string;
  defined_in: ExactRef;
}
export interface PublishedDefinition {
  identity: ExactRef;
  creation: CanonicalCreation;
}
const key = (value: CreationObjectAddress) =>
  JSON.stringify([value.kind, value.parent ?? null, value.id]);

/** IDs that disappear; renaming an ID is removal plus addition, never a guessed correspondence. */
export function removedCreationObjects(
  before: CanonicalCreation,
  after: CanonicalCreation,
): CreationObjectAddress[] {
  if (before.id !== after.id || before.type !== after.type)
    throw new CharError({ code: "impact.identity_mismatch", subject: after.ref });
  const objects = (creation: CanonicalCreation) => {
    const out: CreationObjectAddress[] = [];
    const add = (kind: CreationObjectAddress["kind"], id: string, parent?: string) =>
      out.push({ kind, id, ...(parent ? { parent } : {}) });
    for (const item of creation.fragments) add("fragment", item.id);
    for (const item of creation.groups ?? []) add("group", item.id);
    for (const item of creation.sources ?? []) {
      add("source", item.id);
      for (const section of item.sections ?? []) add("section", section.id, item.id);
    }
    for (const item of creation.cast ?? []) add("cast", item.key);
    for (const item of creation.assets) add("asset", item.slot);
    for (const id of Object.keys(creation.slots ?? {})) add("slot", id);
    for (const id of Object.keys(creation.params ?? {})) add("param", id);
    for (const item of creation.policy?.blocks ?? creation.prompt_module?.blocks ?? [])
      add("block", item.id);
    const collections = {
      scene: "scenes",
      beat: "beats",
      ending: "endings",
      choice: "choices",
      event: "events",
      item: "items",
      plotline: "plotlines",
      timeline: "timelines",
      start: "starts",
    } as const;
    for (const [kind, collection] of Object.entries(collections))
      for (const item of creation.story?.[collection] ?? [])
        add(kind as keyof typeof collections, item.id);
    for (const id of Object.keys(creation.story?.vars ?? {})) add("variable", id);
    return out;
  };
  const retained = new Set(objects(after).map(key));
  return objects(before)
    .filter((object) => !retained.has(key(object)))
    .sort((a, b) => compareStrings(key(a), key(b)));
}

/**
 * Report actual artifact inclusion and schema-defined references to an exact dependency version.
 * Definitions must come from the same immutable release snapshot. No prose or runtime logs are searched.
 */
export function publishedObjectUses(input: {
  objects: readonly CreationObjectAddress[];
  target: ExactRef;
  artifact: CreationArtifact & { root: ExactRef };
  definitions: readonly PublishedDefinition[];
}): PublishedObjectUse[] {
  const { target, artifact } = input;
  const requested = new Map(input.objects.map((object) => [key(object), object]));
  const out = new Map<string, PublishedObjectUse>();
  const emit = (
    object: CreationObjectAddress,
    kind: PublishedObjectUse["kind"],
    path: string,
    defined_in = artifact.root,
  ) => {
    const declared = requested.get(key(object));
    if (!declared) return;
    const value = { object: { ...declared }, kind, path, defined_in };
    out.set(JSON.stringify([key(object), kind, path, defined_in.release]), value);
  };
  const same = (identity: { release?: string; ref?: string; creation?: string }) =>
    identity.release === target.release && (identity.ref ?? identity.creation) === target.ref;
  const effective = new Set([artifact.root.release]);
  const ids = new Map<string, CreationObjectAddress[]>();
  const identify = (id: string, object: CreationObjectAddress) =>
    ids.set(id, [...(ids.get(id) ?? []), object]);
  if (artifact.kind === "content") {
    for (const node of artifact.ir.graph.nodes) if ("release" in node) effective.add(node.release);
    const present = artifact.ir.graph.nodes.some(same);
    const instances = new Set(
      present
        ? artifact.ir.graph.instances
            .filter((instance) => instance.ref === target.ref)
            .map((instance) => instance.key)
        : [],
    );
    for (const fragment of artifact.ir.fragments) {
      if (!same(fragment.origin)) continue;
      const object = { kind: "fragment" as const, id: fragment.origin.fragment };
      identify(fragment.id, object);
      emit(object, "included", `ir.fragments[${fragment.id}]`);
    }
    for (const work of artifact.catalog_index.works) {
      if (!instances.has(work.instance)) continue;
      for (const group of artifact.catalog_index.groups.filter((item) => item.owner === work.id)) {
        const object = { kind: "group" as const, id: group.local_id };
        identify(group.id, object);
        emit(object, "included", `catalog_index.groups[${group.id}]`);
      }
      for (const source of artifact.catalog_index.sources.filter(
        (item) => item.owner === work.id,
      )) {
        const object = { kind: "source" as const, id: source.local_id };
        identify(source.id, object);
        emit(object, "included", `catalog_index.sources[${source.id}]`);
        for (const section of source.sections) {
          const child = { kind: "section" as const, id: section.id, parent: source.local_id };
          identify(`${source.id}/section:${section.id}`, child);
          emit(child, "included", `catalog_index.sources[${source.id}].sections[${section.id}]`);
        }
      }
    }
    for (const instance of artifact.ir.graph.instances)
      if (instance.cast && instances.has(instance.cast.scope))
        emit(
          { kind: "cast", id: instance.cast.key },
          "included",
          `ir.graph.instances[${instance.key}].cast`,
        );
    // Cast overrides belong to the declaring Scenario, including indirect Character paths.
    for (const instance of artifact.ir.graph.instances) {
      if (!instances.has(instance.key) || !instance.cast) continue;
      const owner = artifact.ir.graph.instances.find((item) => item.key === instance.cast?.scope);
      const ownerNode = artifact.ir.graph.nodes.find((item) => item.ref === owner?.ref);
      const definition = input.definitions.find(
        (item) =>
          ownerNode && "release" in ownerNode && item.identity.release === ownerNode.release,
      );
      const role = definition?.creation.cast?.find((item) => item.key === instance.cast?.key);
      role?.override?.forEach((override, i) => {
        if ("target" in override)
          emit(
            { kind: "fragment", id: override.target },
            "explicit",
            `cast[${role.key}].override[${i}].target`,
            definition?.identity,
          );
      });
    }
    const referenced = (
      ref: CatalogRef | AboutTarget,
      path: string,
      defined_in = artifact.root,
    ) => {
      const id =
        "fragment" in ref
          ? ref.fragment
          : "group" in ref
            ? ref.group
            : "source" in ref
              ? ref.source
              : undefined;
      if (id) for (const object of ids.get(id) ?? []) emit(object, "explicit", path, defined_in);
      if ("source" in ref && ref.section)
        for (const object of ids.get(`${ref.source}/section:${ref.section}`) ?? [])
          emit(object, "explicit", path, defined_in);
    };
    const identityOf = (fragmentId: string) => {
      const fragment = artifact.ir.fragments.find((item) => item.id === fragmentId);
      return (
        input.definitions.find(
          (item) =>
            item.identity.release ===
            (fragment && "release" in fragment.origin ? fragment.origin.release : undefined),
        )?.identity ?? artifact.root
      );
    };
    for (const link of artifact.catalog_index.about ?? []) {
      const fragment = artifact.ir.fragments.find((item) => item.id === link.from);
      referenced(
        link.target,
        `fragments[${fragment?.origin.fragment ?? link.from}].about`,
        identityOf(link.from),
      );
    }
    for (const fragment of artifact.ir.fragments)
      if (fragment.source) {
        const resolved = resolveCatalogReference(
          fragment.source.use,
          artifact.ir,
          artifact.catalog_index,
          fragment.origin.instance_key,
          "source",
        );
        referenced(
          resolved,
          `fragments[${fragment.origin.fragment}].source.use`,
          identityOf(fragment.id),
        );
      }
    const story = artifact.story;
    const reference = (ref: string, path: string) => {
      const resolved = artifact.story_refs?.content[ref];
      if (resolved) referenced(resolved, path);
    };
    const condition = (node: StoryCondition | undefined, path: string) => {
      const queue = node ? [{ node, path }] : [];
      while (queue.length) {
        const value = queue.pop();
        if (!value) break;
        if ("knows" in value.node) reference(value.node.knows.info, `${value.path}/knows/info`);
        else if ("not" in value.node)
          queue.push({ node: value.node.not, path: `${value.path}/not` });
        else if ("all" in value.node || "any" in value.node) {
          const op = "all" in value.node ? "all" : "any";
          const children = "all" in value.node ? value.node.all : value.node.any;
          children.forEach((node, i) => {
            queue.push({ node, path: `${value.path}/${op}/${i}` });
          });
        }
      }
    };
    for (const collection of [
      "scenes",
      "beats",
      "endings",
      "choices",
      "events",
      "items",
      "starts",
    ] as const)
      for (const item of story?.[collection] ?? []) {
        const at = `story.${collection}[${item.id}]`;
        if ("place" in item && item.place) reference(item.place, `${at}.place`);
        if ("truth" in item && item.truth) reference(item.truth, `${at}.truth`);
        if ("lore" in item)
          item.lore?.forEach((ref, i) => {
            reference(ref, `${at}.lore[${i}]`);
          });
        if ("when" in item) condition(item.when, `${at}/when`);
        const effects = "effects" in item ? item.effects : "set" in item ? item.set : undefined;
        effects?.forEach((effect, i) => {
          if ("learn" in effect)
            reference(
              effect.learn.info,
              `${at}/${"set" in item ? "set" : "effects"}/${i}/learn/info`,
            );
        });
      }
    for (const ref of Object.keys(story?.knowing ?? {})) reference(ref, `story.knowing[${ref}]`);
  }
  for (const asset of artifact.assets)
    if (same(asset.origin))
      emit({ kind: "asset", id: asset.origin.slot }, "included", `assets[${asset.id}]`);
  const policies =
    artifact.kind === "content"
      ? [artifact.assembly?.preset, artifact.default_policy]
      : artifact.kind === "preset"
        ? [artifact.preset]
        : [artifact.module];
  for (const policy of policies)
    if (policy) {
      if ("release" in policy) effective.add(policy.release);
      for (const block of "policy" in policy ? policy.policy.blocks : policy.blocks)
        if (block.origin) {
          if ("release" in block.origin) effective.add(block.origin.release);
          if (same(block.origin))
            emit(
              { kind: "block", id: block.origin.block },
              "included",
              `policy.blocks[${block.id}]`,
            );
        }
    }
  for (const release of effective)
    if (!input.definitions.some((definition) => definition.identity.release === release))
      throw new CharError({
        code: "impact.definition_missing",
        subject: release,
        detail: "The immutable definition is required to complete the reference report.",
      });
  for (const definition of input.definitions) {
    if (!effective.has(definition.identity.release)) continue;
    const { creation, identity } = definition;
    for (const edge of creation.references) {
      if (
        !edge.pin ||
        !("release" in edge.pin) ||
        edge.pin.release !== target.release ||
        resolveUseRef(edge.use, creation.ref) !== target.ref
      )
        continue;
      const at = `references[${edge.id}]`;
      if (edge.select)
        for (const [mode, patterns] of Object.entries(edge.select))
          patterns.forEach((id: string, i: number) => {
            for (const object of input.objects)
              if (object.kind === "fragment" && matchesFragmentPattern(id, object.id))
                emit(object, "explicit", `${at}.select.${mode}[${i}]`, identity);
          });
      edge.override?.forEach((override, i) => {
        if ("target" in override)
          emit(
            { kind: "fragment", id: override.target },
            "explicit",
            `${at}.override[${i}].target`,
            identity,
          );
      });
      for (const id of Object.keys(edge.bind ?? {}))
        emit({ kind: "slot", id }, "explicit", `${at}.bind.${id}`, identity);
      for (const id of Object.keys(edge.params ?? {}))
        emit({ kind: "param", id }, "explicit", `${at}.params.${id}`, identity);
    }
    for (const fixture of creation.assembly_tests ?? []) {
      if (
        fixture.root === "self" ||
        fixture.root.release !== target.release ||
        fixture.root.ref !== target.ref
      )
        continue;
      // A fixture with this exact root is a legitimate cross-work consumer of local Story IDs.
      for (const [i, selection] of (fixture.selection ?? []).entries()) {
        const path = `assembly_tests[${fixture.id}].selection[${i}]`;
        if ("story" in selection) {
          if (selection.story === "part" || selection.story === "goal")
            emit({ kind: "cast", id: selection.id }, "explicit", path, identity);
          else emit({ kind: selection.story, id: selection.id }, "explicit", path, identity);
        } else {
          for (const object of input.objects) {
            const prefix =
              object.kind === "fragment"
                ? `${target.ref}#${object.id}~`
                : object.kind === "group"
                  ? `${target.ref}#group/${object.id}~`
                  : object.kind === "source" || object.kind === "section"
                    ? `${target.ref}#source/${object.parent ?? object.id}~`
                    : undefined;
            const id =
              "fragment" in selection
                ? selection.fragment
                : "group" in selection
                  ? selection.group
                  : "source" in selection
                    ? selection.source
                    : undefined;
            if (
              prefix &&
              id?.startsWith(prefix) &&
              (object.kind !== "section" ||
                ("source" in selection && selection.section === object.id))
            )
              emit(object, "explicit", path, identity);
          }
        }
      }
      const at = `assembly_tests[${fixture.id}].session`;
      if (fixture.session.scene)
        emit({ kind: "scene", id: fixture.session.scene }, "explicit", `${at}.scene`, identity);
      for (const id of fixture.session.present ?? [])
        emit({ kind: "cast", id }, "explicit", `${at}.present`, identity);
      if (fixture.session.story) {
        const state = fixture.session.story;
        emit({ kind: "start", id: state.start }, "explicit", `${at}.story.start`, identity);
        for (const [field, kind] of [
          ["visited", "scene"],
          ["reached", "beat"],
          ["ended", "ending"],
          ["happened", "event"],
        ] as const)
          for (const id of state[field])
            emit({ kind, id }, "explicit", `${at}.story.${field}`, identity);
        for (const id of Object.keys(state.vars))
          emit({ kind: "variable", id }, "explicit", `${at}.story.vars.${id}`, identity);
        for (const [info, cast] of Object.entries(state.knowing)) {
          for (const id of cast)
            emit({ kind: "cast", id }, "explicit", `${at}.story.knowing[${info}]`, identity);
          if (info.startsWith("#"))
            emit(
              { kind: "fragment", id: info.slice(1) },
              "explicit",
              `${at}.story.knowing[${info}]`,
              identity,
            );
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => compareStrings(JSON.stringify(a), JSON.stringify(b)));
}
