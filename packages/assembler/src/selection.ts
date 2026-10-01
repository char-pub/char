import {
  type CatalogRef,
  CharError,
  digestExactJSON,
  type SelectionPlan,
  SelectionPlanSchema,
} from "@char-pub/core";
import { type CatalogBuild, type CatalogNode, catalogKey, selectorCatalog } from "./catalog.js";

import { parseOrThrow } from "./validation.js";

interface ExposedNode {
  node: CatalogNode;
  depth: number;
}
function initial(build: CatalogBuild): Map<string, ExposedNode> {
  const exposed = new Map<string, ExposedNode>();
  const visit = (node: CatalogNode, depth: number) => {
    exposed.set(catalogKey(node.ref), { node, depth });
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  for (const node of build.catalog.candidates) visit(node, 0);
  return exposed;
}
function shallow(node: CatalogNode): CatalogNode {
  const { children: _children, ...rest } = node;
  return rest;
}
function expansion(
  build: CatalogBuild,
  exposed: Map<string, ExposedNode>,
  ref: CatalogRef,
): CatalogNode[] {
  const key = catalogKey(ref);
  const current = exposed.get(key);
  const full = build.nodes.get(key);
  if (!current || !full?.children || current.depth >= build.selection.max_depth)
    throw new CharError({ code: "selection.invalid_expand", subject: key });
  const children = full.children.map(shallow);
  for (const node of children)
    exposed.set(catalogKey(node.ref), { node, depth: current.depth + 1 });
  return children;
}

/** Replay all exposure decisions against the current view before accepting any chosen body. */
export function validateSelectionPlan(build: CatalogBuild, input: unknown): SelectionPlan {
  const plan = parseOrThrow(SelectionPlanSchema, input, "plan", "selection.invalid_input");
  if (plan.discovery !== build.discovery)
    throw new CharError({ code: "selection.input_mismatch", subject: "discovery" });
  if (digestExactJSON(plan.input) !== digestExactJSON(build.input))
    throw new CharError({ code: "selection.input_mismatch", subject: "input" });
  const exposed = initial(build);
  let cost = build.discovery
    ? build.counter.count(JSON.stringify(selectorCatalog(build.catalog)))
    : 0;
  for (const decision of plan.decisions) {
    if (decision.action === "expand") {
      const children = expansion(build, exposed, decision.ref);
      cost += build.counter.count(JSON.stringify({ parent: decision.ref, children }));
      if (cost > build.selection.catalog_budget)
        throw new CharError({ code: "selection.directory_over_budget", subject: "decisions" });
    } else if (!exposed.has(catalogKey(decision.ref)))
      throw new CharError({
        code: "selection.unexposed_reference",
        subject: catalogKey(decision.ref),
      });
  }
  const selected = new Set<string>();
  const wholeSources = new Set<string>();
  const sectionSources = new Set<string>();
  for (const ref of build.catalog.direct) {
    if ("source" in ref) (ref.section ? sectionSources : wholeSources).add(ref.source);
  }
  for (const item of plan.selected) {
    const key = catalogKey(item.ref);
    const node = exposed.get(key)?.node;
    if (!node || selected.has(key))
      throw new CharError({ code: "selection.invalid_reference", subject: key });
    selected.add(key);
    if ("fragment" in item.ref) {
      if (item.form !== "body")
        throw new CharError({ code: "selection.invalid_form", subject: key });
    } else if ("source" in item.ref) {
      const ref = item.ref;
      if (item.form !== (ref.section ? "section" : "body"))
        throw new CharError({ code: "selection.invalid_form", subject: key });
      (ref.section ? sectionSources : wholeSources).add(ref.source);
    } else throw new CharError({ code: "selection.container_body", subject: key });
  }
  for (const source of wholeSources)
    if (sectionSources.has(source))
      throw new CharError({ code: "selection.overlapping_source", subject: source });
  if (plan.fallback && plan.selected.length)
    throw new CharError({ code: "selection.invalid_fallback", subject: "selected" });
  return plan;
}

/** Deterministic author/test selector; it performs only the expansions needed for its exact refs. */
export function fixedSelection(build: CatalogBuild, refs: readonly CatalogRef[]): SelectionPlan {
  const exposed = initial(build);
  const decisions: SelectionPlan["decisions"] = [];
  const ancestors = new Map<string, CatalogRef[]>();
  const walk = (node: CatalogNode, path: CatalogRef[]) => {
    ancestors.set(catalogKey(node.ref), path);
    for (const child of node.children ?? []) walk(child, [...path, node.ref]);
  };
  for (const root of build.catalog.candidates) {
    const node = build.nodes.get(catalogKey(root.ref));
    if (node) walk(node, []);
  }
  for (const ref of refs) {
    const path = ancestors.get(catalogKey(ref));
    if (!path)
      throw new CharError({ code: "selection.invalid_reference", subject: catalogKey(ref) });
    for (const parent of path) {
      if (exposed.has(catalogKey(ref))) break;
      const full = build.nodes.get(catalogKey(parent));
      const alreadyVisible = full?.children?.every((c) => exposed.has(catalogKey(c.ref)));
      if (alreadyVisible) continue;
      expansion(build, exposed, parent);
      decisions.push({ ref: parent, action: "expand" });
    }
    decisions.push({ ref, action: "select" });
  }
  return validateSelectionPlan(build, {
    discovery: build.discovery,
    input: build.input,
    selector: { name: "fixed", version: "1" },
    decisions,
    selected: refs.map((ref, rank) => ({
      ref,
      rank,
      form: "source" in ref && ref.section ? "section" : "body",
    })),
  });
}

export function noneSelection(build: CatalogBuild): SelectionPlan {
  return validateSelectionPlan(build, {
    discovery: build.discovery,
    input: build.input,
    selector: { name: "none", version: "1" },
    selected: [],
    decisions: [],
  });
}
