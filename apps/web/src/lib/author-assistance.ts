/** Local author-selected input and reviewed output; no model, Registry IO or generic patch execution. */
import {
  canonicalizeCreation,
  checkContentCollections,
  checkCreation,
  checkLocalContentReferences,
  checkStory,
  digestExactJSON,
  FragmentSchema,
  type JSONValue,
  KnowledgeSourceSchema,
  MAX_SOURCE_BYTES,
  type Story,
  StoryConditionSchema,
  StoryObjectSchemas,
  tokenizeTemplate,
} from "@char-pub/core";
import { z } from "zod";
import { contentReferences } from "./content-references";
import { nextId, type Working } from "./draft";
import { type PublishDiffEntry, publishDefinitionDiff } from "./publish-diff";
import { validateSourceDocument, verifiedSourceDocument } from "./source-sections";
import { storyReferences } from "./story-editor";

export const MAX_ASSISTANCE_BYTES = 1024 * 1024;
/** JSON can escape one source byte into six characters; input text is never truncated. */
export const MAX_ASSISTANCE_REQUEST_BYTES = MAX_SOURCE_BYTES * 6 + MAX_ASSISTANCE_BYTES;
export const ASSISTANCE_TASKS = [
  "description",
  "sections",
  "condition",
  "perspective",
  "play",
] as const;
export type AssistanceTask = (typeof ASSISTANCE_TASKS)[number];
export type AssistanceKind =
  | "scene"
  | "beat"
  | "ending"
  | "choice"
  | "var"
  | "group"
  | "source"
  | "fragment";
export interface AssistanceTarget {
  kind: AssistanceKind;
  id: string;
}
export interface AssistanceSelection {
  kind: AssistanceTask;
  target: AssistanceTarget;
  instructions: string;
  context: string;
  outward_id?: string;
  outward_scope?: "preserve" | "shared";
  scene?: string;
}
type ObjectValue = Record<string, unknown>;
const collections = {
  scene: "scenes",
  beat: "beats",
  ending: "endings",
  choice: "choices",
  group: "groups",
  source: "sources",
  fragment: "fragments",
} as const;
function record(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The selected object is incomplete. Restore its object fields first.");
  return value as ObjectValue;
}
function root(w: Working, kind: AssistanceKind): ObjectValue {
  return ["scene", "beat", "ending", "choice", "var"].includes(kind) ? record(w.story) : w;
}
function objects(w: Working, kind: Exclude<AssistanceKind, "var">): ObjectValue[] {
  const values = root(w, kind)[collections[kind]];
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error("Restore the selected object collection first.");
  return values.map(record);
}
export function assistanceTargets(w: Working, task: AssistanceTask): AssistanceTarget[] {
  const kinds: AssistanceKind[] =
    task === "description"
      ? ["beat", "ending", "var", "group", "source"]
      : task === "sections"
        ? ["source"]
        : task === "condition"
          ? ["scene", "beat", "ending", "choice"]
          : task === "perspective"
            ? ["fragment"]
            : [];
  return kinds.flatMap((kind) => {
    try {
      const entries: ObjectValue[] =
        kind === "var"
          ? Object.keys(record(root(w, kind).vars ?? {})).map((id) => ({ id }))
          : objects(w, kind);
      return entries.flatMap((item) => {
        if (
          typeof item.id !== "string" ||
          entries.filter((entry) => entry.id === item.id).length !== 1
        )
          return [];
        if (
          task === "perspective" &&
          (!["character", "persona"].includes(String(item.kind)) ||
            record(item.content).type !== "text")
        )
          return [];
        return [{ kind, id: item.id }];
      });
    } catch {
      return [];
    }
  });
}
function value(w: Working, target: AssistanceTarget): ObjectValue | undefined {
  if (target.kind === "var") {
    const variables = record(root(w, target.kind).vars ?? {});
    return Object.hasOwn(variables, target.id) ? record(variables[target.id]) : undefined;
  }
  const found = objects(w, target.kind).filter((item) => item.id === target.id);
  if (found.length > 1)
    throw new Error("The selected ID is duplicated. Fix the IDs before requesting help.");
  return found[0];
}
function replace(w: Working, target: AssistanceTarget, after: ObjectValue | undefined): Working {
  const next = structuredClone(w),
    owner = root(next, target.kind);
  if (target.kind === "var") {
    const variables = { ...record(owner.vars ?? {}) };
    if (after === undefined) delete variables[target.id];
    else variables[target.id] = after;
    owner.vars = variables;
  } else {
    const all = objects(next, target.kind),
      index = all.findIndex((item) => item.id === target.id);
    if (index < 0 && after !== undefined) all.push(after);
    else if (index >= 0 && after === undefined) all.splice(index, 1);
    else if (index >= 0) all[index] = after as ObjectValue;
    owner[collections[target.kind]] = all;
  }
  return next;
}
function size(text: string, limit = MAX_ASSISTANCE_BYTES) {
  if (new TextEncoder().encode(text).length > limit)
    throw new Error(`This assistance JSON exceeds ${limit} bytes. Choose a smaller input.`);
}
export function assistanceWorkingDigest(w: Working): string {
  return digestExactJSON(w);
}
const description = FragmentSchema.shape.description.unwrap();
const outputSchemas = {
  description: z.strictObject({ description }),
  sections: z.strictObject({ sections: KnowledgeSourceSchema.shape.sections.unwrap() }),
  condition: z.strictObject({ condition: StoryConditionSchema }),
  perspective: z.strictObject({ outward_text: z.string().min(1), inner_text: z.string().min(1) }),
};
function outputSchema(selection: AssistanceSelection) {
  if (selection.kind !== "play") return outputSchemas[selection.kind];
  if (!["scene", "beat", "ending"].includes(selection.target.kind))
    throw new Error("Choose a scene, change or ending to draft.");
  return z.strictObject({
    object: StoryObjectSchemas[selection.target.kind as "scene" | "beat" | "ending"],
  });
}
export interface AssistanceRequest {
  format: "char.pub/author-assistance-request";
  version: 1;
  creation: { id: string; ref: string; type: string };
  working_digest: string;
  task: AssistanceSelection;
  input: {
    selected: ObjectValue | null;
    context: string;
    source_text?: string;
    scene?: ObjectValue;
  };
  response_schema: Record<string, unknown>;
  request_digest: string;
}
function candidateSchema(
  request: Pick<AssistanceRequest, "creation" | "working_digest" | "request_digest" | "task">,
) {
  return z.strictObject({
    format: z.literal("char.pub/author-assistance-candidate"),
    version: z.literal(1),
    creation_id: z.literal(request.creation.id),
    working_digest: z.literal(request.working_digest),
    request_digest: z.literal(request.request_digest),
    output: outputSchema(request.task),
  });
}
/** Full draft identity is bound by a digest; only the author-selected object and explicit context are exported. */
export function createAssistanceRequest(
  w: Working,
  selection: AssistanceSelection,
  sourceBytes?: Uint8Array,
): AssistanceRequest {
  if (typeof w.id !== "string" || typeof w.ref !== "string" || typeof w.type !== "string")
    throw new Error("Open a saved creation before requesting help.");
  if (!selection.instructions.trim())
    throw new Error("Describe what you want the service to draft.");
  if (selection.target.id === "__proto__" || !selection.target.id)
    throw new Error("Choose a valid stable ID.");
  const task = structuredClone(selection);
  const selected = value(w, task.target);
  if (task.kind === "play") {
    outputSchema(task);
    if (selected) throw new Error("This Story ID already exists. Choose a new ID.");
    if (!w.story) throw new Error("Add the first scene before drafting another Story object.");
    if (
      task.target.kind === "beat" &&
      (!task.scene || !value(w, { kind: "scene", id: task.scene }))
    )
      throw new Error("Choose the scene where this change belongs.");
  } else if (
    !assistanceTargets(w, task.kind).some(
      (target) => target.kind === task.target.kind && target.id === task.target.id,
    )
  )
    throw new Error("Choose an existing supported object with a unique ID.");
  if (task.kind === "perspective") {
    const ids = objects(w, "fragment").map((item) => String(item.id));
    task.outward_id ??= nextId(ids, `${task.target.id}-outward`);
    FragmentSchema.shape.id.parse(task.outward_id);
    if (ids.includes(task.outward_id)) throw new Error("The outward passage ID already exists.");
  }
  let sourceText: string | undefined;
  if (task.kind === "sections") {
    if (!sourceBytes)
      throw new Error("Choose the original uploaded document before preparing a section request.");
    const source = KnowledgeSourceSchema.parse(selected);
    sourceText = verifiedSourceDocument(w, source, sourceBytes);
  }
  const basis = {
    format: "char.pub/author-assistance-request" as const,
    version: 1 as const,
    creation: { id: w.id, ref: w.ref, type: w.type },
    working_digest: assistanceWorkingDigest(w),
    task,
    input: {
      selected: selected ? structuredClone(selected) : null,
      context: task.context,
      ...(task.kind === "play" && task.target.kind === "beat" && task.scene
        ? { scene: structuredClone(record(value(w, { kind: "scene", id: task.scene }))) }
        : {}),
      ...(sourceText === undefined ? {} : { source_text: sourceText }),
    },
  };
  const requestDigest = digestExactJSON(basis);
  const request: AssistanceRequest = {
    ...basis,
    request_digest: requestDigest,
    response_schema: z.toJSONSchema(candidateSchema({ ...basis, request_digest: requestDigest })),
  };
  size(
    JSON.stringify(request, null, 2),
    task.kind === "sections" ? MAX_ASSISTANCE_REQUEST_BYTES : MAX_ASSISTANCE_BYTES,
  );
  return request;
}
function currentRequest(w: Working, request: AssistanceRequest) {
  const { request_digest, response_schema: _, ...basis } = request;
  if (digestExactJSON(basis) !== request_digest)
    throw new Error("The local request changed. Prepare a new request.");
  if (w.id !== request.creation.id || assistanceWorkingDigest(w) !== request.working_digest)
    throw new Error("The draft changed. Prepare a new request and review its new candidate.");
}
interface Patch {
  target: AssistanceTarget;
  field?: string;
  before?: unknown;
  after?: unknown;
}
export interface AssistanceReview {
  request: AssistanceRequest;
  candidate: unknown;
  patches: Patch[];
  before: Working;
  after: Working;
  differences: PublishDiffEntry[];
  diagnostics: string[];
  digest: string;
}
function patch(w: Working, change: Patch, undo = false): Working {
  const replacement = undo ? change.before : change.after;
  if (!change.field) return replace(w, change.target, replacement as ObjectValue | undefined);
  const object = value(w, change.target);
  if (!object) throw new Error("The selected object no longer exists.");
  const next = { ...object };
  if (replacement === undefined) delete next[change.field];
  else next[change.field] = replacement;
  return replace(w, change.target, next);
}
function snapshot(patches: Patch[]) {
  return patches.map((p) => ({ ...p, before: p.before ?? null, after: p.after ?? null }));
}
function diagnostics(w: Working): string[] {
  try {
    return checkCreation(canonicalizeCreation(w).creation).diagnostics.map(
      (d) => `${d.subject}: ${d.detail ?? d.code}`,
    );
  } catch (error) {
    return [`Unfinished draft: ${error instanceof Error ? error.message : String(error)}`];
  }
}
export function reviewAssistanceCandidate(
  w: Working,
  request: AssistanceRequest,
  text: string,
): AssistanceReview {
  currentRequest(w, request);
  size(text);
  const candidate = candidateSchema(request).parse(JSON.parse(text));
  const output = candidate.output as ObjectValue,
    target = request.task.target,
    selected = value(w, target);
  const patches: Patch[] = [];
  const field = (name: string, after: unknown) =>
    patches.push({
      target,
      field: name,
      ...(selected && Object.hasOwn(selected, name) ? { before: selected[name] } : {}),
      after,
    });
  switch (request.task.kind) {
    case "description":
      field("description", output.description);
      break;
    case "condition":
      field("when", output.condition);
      break;
    case "sections": {
      const source = KnowledgeSourceSchema.parse({ ...selected, sections: output.sections });
      validateSourceDocument(source, request.input.source_text ?? "");
      if (new Set(source.sections?.map((section) => section.id)).size !== source.sections?.length)
        throw new Error("Section IDs must be unique.");
      if (source.sections?.some((section) => !section.description))
        throw new Error("Give every generated section a description.");
      field("sections", source.sections);
      break;
    }
    case "perspective": {
      const original = FragmentSchema.parse(selected),
        content = original.content;
      if (content.type !== "text" || !request.task.outward_id)
        throw new Error("Choose a text-based character passage.");
      field("content", { ...content, text: output.inner_text });
      field("outward", false);
      const outward = FragmentSchema.parse({
        id: request.task.outward_id,
        stable: true,
        kind: original.kind,
        outward: true,
        content: {
          type: "text",
          text: output.outward_text,
          ...(content.format ? { format: content.format } : {}),
        },
        ...(original.activation ? { activation: original.activation } : {}),
        ...(request.task.outward_scope === "shared"
          ? { visibility: { scope: "shared" } }
          : original.visibility
            ? { visibility: original.visibility }
            : {}),
      });
      patches.push({ target: { kind: "fragment", id: outward.id }, after: outward });
      break;
    }
    case "play": {
      const object = record(output.object);
      if (object.id !== target.id)
        throw new Error("The candidate must keep the requested new object ID.");
      patches.push({ target, after: object });
      if (target.kind === "beat" && request.task.scene) {
        const sceneTarget: AssistanceTarget = { kind: "scene", id: request.task.scene };
        const scene = value(w, sceneTarget);
        const beats = scene?.beats;
        if (
          beats !== undefined &&
          (!Array.isArray(beats) || beats.some((id) => typeof id !== "string"))
        )
          throw new Error("Restore this scene's change references first.");
        if (!(beats as string[] | undefined)?.includes(target.id))
          patches.push({
            target: sceneTarget,
            field: "beats",
            ...(beats === undefined ? {} : { before: beats }),
            after: [...((beats as string[] | undefined) ?? []), target.id],
          });
      }
      break;
    }
  }
  let after = patches.reduce((next, change) => patch(next, change), structuredClone(w));
  assertReferences(w, after, patches);
  after = markAgent(after);
  let differences: PublishDiffEntry[];
  try {
    differences = publishDefinitionDiff(w, after).entries;
  } catch {
    differences = patches.map((p) => ({
      category:
        p.field === "description" ? "description" : p.field === "content" ? "body" : "structure",
      path: [p.target.kind, p.target.id, ...(p.field ? [p.field] : [])],
      object: `${p.target.kind} ${p.target.id}`,
      field: p.field ?? "Object",
      change: p.before === undefined ? "added" : "changed",
      ...(p.before === undefined ? {} : { before: p.before as JSONValue }),
      after: p.after as JSONValue,
    }));
  }
  const review = {
    request: structuredClone(request),
    candidate,
    patches,
    before: structuredClone(w),
    after,
    differences,
    diagnostics: diagnostics(after),
  };
  return {
    ...review,
    digest: digestExactJSON({
      request: review.request,
      candidate,
      patches: snapshot(patches),
      after,
    }),
  };
}
function markAgent(w: Working): Working {
  return {
    ...w,
    provenance: { ...(w.provenance ? record(w.provenance) : {}), authored_by_agent: true },
  };
}
export function applyAssistanceReview(w: Working, review: AssistanceReview): Working {
  currentRequest(w, review.request);
  if (
    review.digest !==
    digestExactJSON({
      request: review.request,
      candidate: review.candidate,
      patches: snapshot(review.patches),
      after: review.after,
    })
  )
    throw new Error("The review changed. Review the candidate again.");
  return structuredClone(review.after);
}
export function undoAssistanceReview(w: Working, review: AssistanceReview): Working {
  if (w.id !== review.request.creation.id)
    throw new Error("This assistance belongs to another creation.");
  for (const p of review.patches) {
    const selected = value(w, p.target),
      actual = p.field ? selected?.[p.field] : selected;
    if (digestExactJSON(actual ?? null) !== digestExactJSON(p.after ?? null))
      throw new Error(
        "The assisted content was edited again. Keep those edits or restore the reviewed content before undoing.",
      );
  }
  const after = [...review.patches]
    .reverse()
    .reduce((next, change) => patch(next, change, true), structuredClone(w));
  for (const p of review.patches) {
    const inbound = (draft: Working): string[] => {
      if (!p.field && p.before === undefined) {
        if (p.target.kind === "fragment") return contentReferences(draft, "fragment", p.target.id);
        if (["scene", "beat", "ending"].includes(p.target.kind))
          return storyReferences(draft, p.target.kind as "scene" | "beat" | "ending", p.target.id);
      }
      if (p.target.kind === "source" && p.field === "sections") {
        const previous = new Set(
          ((p.before ?? []) as { id: string }[]).map((section) => section.id),
        );
        return (p.after as { id: string }[])
          .filter((section) => !previous.has(section.id))
          .flatMap((section) => contentReferences(draft, "section", p.target.id, section.id));
      }
      return [];
    };
    const prior = new Set(inbound(review.before));
    const added = inbound(after).filter((path) => !prior.has(path));
    if (added.length)
      throw new Error(
        `Cannot undo: later references use this assisted object (${added.join(", ")}). Remove or update those references first.`,
      );
  }
  assertReferences(w, after, [], review.before);
  return markAgent(after);
}

interface Issue {
  code: string;
  subject: string;
  detail?: string | undefined;
  severity: string;
}
function referenceIssues(w: Working): Issue[] {
  const issues: Issue[] = [
    ...checkLocalContentReferences(
      w as unknown as Parameters<typeof checkLocalContentReferences>[0],
    ),
  ];
  issues.push(
    ...checkContentCollections({
      type: w.type,
      description: w.description,
      groups: w.groups,
      sources: w.sources,
      fragments: w.fragments ?? [],
      assets: w.assets ?? [],
    } as Parameters<typeof checkContentCollections>[0]),
  );
  const cast = Array.isArray(w.cast)
    ? w.cast.flatMap((entry) => (typeof entry?.key === "string" ? [entry.key] : []))
    : [];
  if (w.story) issues.push(...checkStory(w.story as Story, cast));
  const names = {
    cast: new Set(cast),
    slot: new Set(Object.keys(w.slots ?? {})),
    param: new Set(Object.keys(w.params ?? {})),
  };
  function text(value: unknown, subject: string) {
    const texts =
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.values(value)
          : [];
    for (const entry of texts) {
      if (typeof entry !== "string") continue;
      const parsed = tokenizeTemplate(entry);
      for (const issue of parsed.issues) issues.push({ ...issue, subject, severity: "error" });
      for (const token of parsed.tokens)
        if (
          (token.t === "cast" || token.t === "slot" || token.t === "param") &&
          !names[token.t].has(token.name)
        )
          issues.push({
            code: "template.missing_reference",
            subject,
            severity: "error",
            detail: `Unknown ${token.t} '${token.name}'.`,
          });
    }
  }
  for (const fragment of w.fragments ?? []) {
    if (fragment.content?.type === "text")
      text(fragment.content.text, `fragments[${fragment.id}]/content`);
    for (const [locale, translated] of Object.entries(fragment.locale ?? {}))
      if (translated.content.type === "text")
        text(translated.content.text, `fragments[${fragment.id}]/locale/${locale}`);
  }
  for (const scene of (w.story as Story | undefined)?.scenes ?? [])
    text(scene.opening, `story.scenes[${scene.id}]/opening`);
  try {
    issues.push(...checkCreation(canonicalizeCreation(w).creation).diagnostics);
  } catch {
    /* Incomplete prose is separately reported; references above remain checked. */
  }
  return issues.filter((issue) => issue.severity === "error");
}
function assertReferences(
  before: Working,
  after: Working,
  patches: Patch[],
  baseline: Working = before,
) {
  const key = (issue: Issue) => `${issue.code}:${issue.subject}`;
  const existing = new Set([...referenceIssues(before), ...referenceIssues(baseline)].map(key));
  const normalize = (subject: string) => subject.replaceAll(".", "/");
  const touched = patches
    .filter((p) => p.field !== "beats")
    .map((p) => {
      const prefix = ["scene", "beat", "ending", "choice", "var"].includes(p.target.kind)
        ? "story/"
        : "";
      const collection = p.target.kind === "var" ? "vars" : collections[p.target.kind];
      return `${prefix}${collection}[${p.target.id}]${p.field ? `/${p.field}` : ""}`;
    });
  const added = referenceIssues(after).filter(
    (issue) =>
      !existing.has(key(issue)) ||
      touched.some((path) => normalize(issue.subject).startsWith(path)),
  );
  if (added.length)
    throw new Error(
      `Candidate has invalid references or field values: ${[...new Set(added.map((issue) => `${issue.subject}: ${issue.detail ?? issue.code}`))].join("; ")}`,
    );
}
