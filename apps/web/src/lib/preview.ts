/**
 * Context Preview 的计算部分：给定发布产物与界面上的设置，准备逐视角上下文，
 * 得到 Trace 或一个可以展示给用户的错误。与 React 无关，便于单独测试。
 */
import {
  type AssembleResult,
  type ContentArtifact,
  type ContextAssemblyInput,
  catalogKey,
  createPreparationCatalog,
  estimateCounter,
  fixedSelection,
  type LateBindingValue,
  localizedString,
  type OpeningMessage,
  prepareContext,
  sourceRequests,
  startSession,
  type TokenCounter,
} from "@char-pub/assembler";
import {
  type CatalogRef,
  CharError,
  type ContextIR,
  isCharError,
  type ResolvedPreset,
  type StoryJudgment,
  type TurnViewInput,
  toTurnStory,
  USER_LATE_SLOT,
  validateStoryState,
} from "@char-pub/core";
import { isApiError, type RegistryClient } from "./api";
import type { StoryRehearsal } from "./story-rehearsal";

export interface PreviewSettings {
  selection?: CatalogRef[];
  locale: string;
  mode: "narrator" | "per-agent";
  contextWindow: number;
  images?: boolean;
  reserveForOutput: number;
  persona: { name: string; description: string; outwardDescription?: string };
  /** 每行一条消息，以 `user:` 或 `assistant:` 开头；没有前缀的按 user 处理。 */
  historyText: string;
  manualEnabled: string[];
  lateBindings?: Record<
    string,
    { name: string; description: string; kind: string; outwardDescription?: string }
  >;
  forParticipant?: string;
  start?: string;
  judgments?: StoryJudgment[];
  rehearsal?: StoryRehearsal;
  /** An explicit full runtime snapshot takes precedence over fresh-opening initialization. */
  turn?: TurnViewInput;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
  locale: "en",
  mode: "narrator",
  contextWindow: 8192,
  reserveForOutput: 1024,
  persona: { name: "Sam", description: "" },
  historyText: "user: Have you heard what Arasaka is planning?",
  manualEnabled: [],
};

export type PreviewOutcome =
  | { ok: true; result: AssembleResult }
  | { ok: false; code: string; title: string; detail: string };

export function parseHistory(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = /^(user|assistant)\s*:\s*(.*)$/i.exec(line);
      if (!m) return { role: "user" as const, text: line };
      const role = m[1]?.toLowerCase() === "assistant" ? ("assistant" as const) : ("user" as const);
      return { role, text: m[2] ?? "" };
    });
}

/**
 * 为界面生成 late slot 绑定：隐式用户绑定到界面上填写的 Persona；其他 late slot
 * 必须由用户逐槽填写，不能用同一个 Persona 隐式填满。
 */
export function bindingsFor(
  ir: ContextIR,
  persona: PreviewSettings["persona"],
  bindings: NonNullable<PreviewSettings["lateBindings"]> = {},
): Record<string, LateBindingValue> {
  const out: Record<string, LateBindingValue> = {};
  for (const slot of ir.late_slots) {
    const explicit = bindings[slot.key];
    const selected =
      explicit ?? (slot.key === USER_LATE_SLOT ? { ...persona, kind: "persona" } : undefined);
    if (!selected?.name.trim()) continue;
    out[slot.key] = {
      kind: selected.kind as LateBindingValue["kind"],
      display_name: selected.name.trim(),
      ...(selected.description.trim() ? { description: selected.description.trim() } : {}),
      ...(selected.outwardDescription?.trim()
        ? { outward_description: selected.outwardDescription.trim() }
        : {}),
    };
  }
  return out;
}

const FRIENDLY: Record<string, { title: string; hint: string }> = {
  "assemble.fixed_over_budget": {
    title: "Opening and history do not fit",
    hint: "Raise the context window or shorten the sample messages and session notes.",
  },
  "assemble.required_over_budget": {
    title: "Required story content does not fit",
    hint: "Raise the context window to include the scene and required roles.",
  },
  "source.body_unavailable": {
    title: "A reference document is unavailable",
    hint: "The selected document must be loaded before this context can be previewed.",
  },
  "assemble.pinned_over_budget": {
    title: "Pinned content does not fit",
    hint: "Pinned fragments are never cut. Raise the context window or unpin something.",
  },
  "assemble.late_slot_unbound": {
    title: "A required role is not bound",
    hint: "Fill in a name for each required role in the Session controls.",
  },
  "assemble.late_slot_kind_mismatch": {
    title: "Wrong kind of binding",
    hint: "This slot needs a different kind of character or persona.",
  },
};

export interface PreviewInitialization {
  turn: TurnViewInput;
  opening: OpeningMessage | null;
}

export function previewInitialization(
  artifact: ContentArtifact,
  settings: PreviewSettings,
): PreviewInitialization {
  if (settings.turn) return { turn: settings.turn, opening: null };
  const start = settings.start ?? artifact.story?.starts?.[0]?.id;
  const started = startSession({
    artifact,
    bindings: bindingsFor(artifact.ir, settings.persona, settings.lateBindings),
    locale: settings.locale,
    // The preview's opening picker explicitly defaults to its first displayed option.
    ...(start ? { start } : {}),
    judgments: settings.rehearsal?.openingJudgments ?? settings.judgments ?? [],
  });
  if (settings.rehearsal) {
    if (!artifact.story || !artifact.story_refs)
      throw new CharError({ code: "story.invalid_state", subject: "preview" });
    validateStoryState(
      artifact.story,
      Object.keys(artifact.story_refs.participants),
      settings.rehearsal.state,
    );
  }
  return {
    opening: started.opening,
    turn: {
      ...started.turn,
      ...(settings.rehearsal
        ? {
            scene: settings.rehearsal.state.scene,
            present: settings.rehearsal.state.present,
            story: toTurnStory(settings.rehearsal.state),
          }
        : {}),
      judgments: settings.judgments ?? [],
      ...(settings.mode === "per-agent" && settings.forParticipant
        ? { for_participant: settings.forParticipant }
        : {}),
      history: [...started.turn.history, ...parseHistory(settings.historyText)],
      manual_enabled: settings.manualEnabled,
    },
  };
}

export function previewTurn(artifact: ContentArtifact, settings: PreviewSettings): TurnViewInput {
  return previewInitialization(artifact, settings).turn;
}

export function previewPreparation(
  artifact: ContentArtifact,
  settings: PreviewSettings,
  counter: TokenCounter = estimateCounter,
  preset?: ResolvedPreset,
): { input: ContextAssemblyInput; opening: OpeningMessage | null } {
  const initialized = previewInitialization(artifact, settings);
  const input: ContextAssemblyInput = {
    artifact,
    counter,
    preset: preset ?? null,
    diagnostics: "author",
    profile: {
      runtime: { name: "char.pub playground", version: "0" },
      tokenizer: counter.tokenizer,
      context_window: settings.contextWindow,
      reserve_for_output: settings.reserveForOutput,
      mode: settings.mode,
      capabilities: {
        images: settings.images ?? false,
        system_role: true,
        multiple_system_messages: true,
      },
      locale: settings.locale,
    },
    turn: initialized.turn,
  };
  return { input, opening: initialized.opening };
}

export function previewInput(
  artifact: ContentArtifact,
  settings: PreviewSettings,
  counter: TokenCounter = estimateCounter,
  preset?: ResolvedPreset,
): ContextAssemblyInput {
  return previewPreparation(artifact, settings, counter, preset).input;
}

export function selectPreviewInput(input: ContextAssemblyInput, refs: readonly CatalogRef[] = []) {
  return refs.length
    ? { ...input, plan: fixedSelection(createPreparationCatalog(input), refs) }
    : input;
}

export interface PreviewSourceChoice {
  ref: Extract<CatalogRef, { source: string }>;
  title: string;
  description?: string;
  required: boolean;
}

/** Only the current view's catalog may supply directory entries; this never loads a body. */
export function previewSourceChoices(input: ContextAssemblyInput): PreviewSourceChoice[] {
  const build = createPreparationCatalog(input);
  const choices: PreviewSourceChoice[] = [];
  const seen = new Set<string>();
  for (const ref of [...build.catalog.required, ...build.catalog.direct]) {
    if (!("source" in ref) || seen.has(catalogKey(ref))) continue;
    seen.add(catalogKey(ref));
    const source = build.context.artifact.catalog_index.sources.find((s) => s.id === ref.source);
    if (!source) continue;
    const section = ref.section ? source.sections.find((s) => s.id === ref.section) : undefined;
    const locale = build.context.turn.locale ?? build.context.artifact.meta.default_locale;
    const title = section?.title ?? source.title;
    const description = section?.description ?? source.description;
    const local = (value: typeof title) =>
      localizedString(value, locale, build.context.artifact.meta.default_locale);
    choices.push({
      ref,
      title: local(title),
      ...(description ? { description: local(description) } : {}),
      required: true,
    });
  }
  for (const node of build.nodes.values()) {
    if (!("source" in node.ref) || seen.has(catalogKey(node.ref))) continue;
    try {
      // Respects current visibility, partial-direct overlap, expansion depth and directory budget.
      fixedSelection(build, [node.ref]);
    } catch {
      continue;
    }
    seen.add(catalogKey(node.ref));
    choices.push({
      ref: node.ref,
      title: node.title,
      ...(node.description ? { description: node.description } : {}),
      required: false,
    });
  }
  return choices;
}

/** Fixed author selections may reach only candidates accepted by the same preparation contract. */
export function previewFragmentChoices(
  input: ContextAssemblyInput,
): { ref: Extract<CatalogRef, { fragment: string }>; title: string; description?: string }[] {
  const build = createPreparationCatalog(input);
  const included = new Set([...build.catalog.required, ...build.catalog.direct].map(catalogKey));
  return [...build.nodes.values()].flatMap((node) => {
    if (!("fragment" in node.ref) || included.has(catalogKey(node.ref))) return [];
    try {
      fixedSelection(build, [node.ref]);
    } catch {
      return [];
    }
    return [
      {
        ref: node.ref,
        title: node.title,
        ...(node.description ? { description: node.description } : {}),
      },
    ];
  });
}

export async function loadPreviewSources(
  client: Pick<RegistryClient, "sourceText" | "draftSourceText">,
  input: ContextAssemblyInput,
  signal?: AbortSignal,
): Promise<Readonly<Record<string, string>>> {
  const requests = sourceRequests(input);
  if (
    requests.length &&
    "origin" in input.artifact.root &&
    input.artifact.root.origin.kind === "local-build"
  )
    throw new CharError({
      code: "source.local_body_required",
      subject: input.artifact.root.ref,
      detail:
        "Local builds require locally supplied reference text; they have no Registry draft access.",
    });
  const loaded = await Promise.all(
    requests.map(async (request) => {
      const root = input.artifact.root;
      const response =
        "origin" in root && root.origin.kind === "draft-build"
          ? await client.draftSourceText(root.origin.build_id, request.source, signal)
          : "release" in root
            ? await client.sourceText(root.release, request.source, signal)
            : (() => {
                throw new CharError({ code: "source.local_body_required", subject: root.ref });
              })();
      if (
        response.source !== request.source ||
        response.asset !== request.asset ||
        response.digest !== request.digest
      )
        throw new CharError({
          code: "source.response_mismatch",
          subject: request.source,
          detail:
            "The registry returned a different reference document. Reload the preview and try again.",
        });
      return [request.asset, response.text] as const;
    }),
  );
  return Object.fromEntries(loaded);
}

export function previewFailure(e: unknown): Extract<PreviewOutcome, { ok: false }> {
  const code = isCharError(e) || isApiError(e) ? e.code : "assembly.failed";
  const friendly = FRIENDLY[code];
  const access = isApiError(e) && (e.status === 401 || e.status === 403 || e.status === 404);
  return {
    ok: false,
    code,
    title: access
      ? "A reference document is unavailable to this account"
      : (friendly?.title ?? "The context could not be assembled"),
    detail: access
      ? "Sign in with access to this work, or choose another reference document."
      : friendly
        ? `${friendly.hint}${isCharError(e) && e.detail ? ` (${e.detail})` : ""}`
        : isCharError(e)
          ? (e.detail ?? e.subject)
          : e instanceof Error
            ? e.message
            : String(e),
  };
}

export function runPreview(
  artifact: ContentArtifact,
  settings: PreviewSettings,
  counter: TokenCounter = estimateCounter,
  preset?: ResolvedPreset,
  source_texts?: Readonly<Record<string, string>>,
): PreviewOutcome {
  try {
    return {
      ok: true,
      result: prepareContext({
        ...selectPreviewInput(
          previewInput(artifact, settings, counter, preset),
          settings.selection,
        ),
        ...(source_texts ? { source_texts } : {}),
      }),
    };
  } catch (e) {
    return previewFailure(e);
  }
}
