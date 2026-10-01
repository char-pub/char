/** Internal renderer for already validated and projected Context Engine admission.
 * Visibility and activation belong to Catalog preparation; layout always comes from a locked policy.
 */
import {
  type AssemblyTrace,
  buildIdentity,
  CharError,
  type ContextIR,
  ContextIRSchema,
  type CreativeRegion,
  compareStrings,
  type IRFragment,
  type Origin,
  type ResolvedPreset,
  ResolvedPresetSchema,
  type RuntimeProfile,
  RuntimeProfileSchema,
  SELF_PARTICIPANT,
  USER_LATE_SLOT,
} from "@char-pub/core";
import { type Attachment, DEFAULT_LABELS, type Labels, RenderContext } from "./render.js";
import { type Session, type SessionInput, SessionSchema } from "./session.js";
import { estimateCounter, type TokenCounter } from "./tokens.js";
import { parseOrThrow } from "./validation.js";

export type TraceEntry = AssemblyTrace["entries"][number];
export type TraceReason = TraceEntry["reason"];

export interface AssembledMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** 组成这条消息的来源：IR fragment ID、`session:*` 或 `history`。 */
  source: string[];
  /** 随消息发送的图片（只有 Runtime 支持图片时才有）。 */
  attachments?: Attachment[];
}

export interface PreparedRenderInput {
  ir: ContextIR;
  profile: RuntimeProfile;
  session: SessionInput;
  /** 由 resolvePreset 校验快照完整性后生成的独立策略输入。 */
  preset: ResolvedPreset;
  /** 已加载的 tokenizer，缺省使用估算。 */
  counter?: TokenCounter;
  labels?: Labels;
  /** Internal admission produced by the validated Catalog/Plan pipeline. */
  prepared: PreparedAdmission;
}

export interface AdmittedFragment {
  reason: "required" | "direct" | "selected";
  required: boolean;
  order: number;
  prefix?: string;
  region?: Region;
}
export interface PreparedText {
  id: string;
  text: string;
  region: Region;
  required: boolean;
  order: number;
  reason: "required" | "direct" | "selected";
}
export interface PreparedAdmission {
  fragments: ReadonlyMap<string, AdmittedFragment>;
  extra: readonly PreparedText[];
}

export interface AssembleResult {
  messages: AssembledMessage[];
  trace: AssemblyTrace;
}

export const SYSTEM_REGION_ORDER = [
  "system:character",
  "system:cast",
  "session:bindings",
  "system:persona",
  "system:world",
  "system:scenario",
  "system:scene",
  "system:story",
  "system:sources",
  "system:relationship",
  "system:knowledge",
  "system:style",
  "system:instruction",
  "system:examples",
  "session:memory",
  "session:state",
  "session:variants",
] as const;
export type Region = (typeof SYSTEM_REGION_ORDER)[number] | "history";

export const ASSEMBLER = { name: "@char-pub/assembler", version: "0.0.0" } as const;

export function regionFor(f: Pick<IRFragment, "placement_hint" | "subject">): Region {
  switch (f.placement_hint) {
    case "character":
      return f.subject === undefined || f.subject === SELF_PARTICIPANT
        ? "system:character"
        : "system:cast";
    case "examples":
      return "system:examples";
    default:
      return `system:${f.placement_hint}`;
  }
}

/** 选择组装使用的 locale：Session 优先，其次 Runtime Profile，最后 IR 的默认 locale。 */
export function chooseLocale(ir: ContextIR, profile: RuntimeProfile, session: Session): string {
  return session.locale ?? profile.locale ?? ir.meta.default_locale;
}

/**
 * 检查 late slot 绑定：必需的 slot 必须绑定，绑定对象的类型必须在 accepts 中。
 * 可选且没有被使用的 slot 可以不绑定。
 */
export function checkLateBindings(ir: ContextIR, session: Session): void {
  for (const slot of ir.late_slots) {
    const b = session.bindings[slot.key];
    if (!b) {
      if (slot.required) {
        throw new CharError({
          code: "assemble.late_slot_unbound",
          subject: slot.key,
          detail:
            slot.key === USER_LATE_SLOT
              ? "the session user persona must be bound"
              : "a required late slot is not bound",
        });
      }
      continue;
    }
    if (!slot.accepts.includes(b.kind)) {
      throw new CharError({
        code: "assemble.late_slot_kind_mismatch",
        subject: slot.key,
        detail: `slot accepts ${slot.accepts.join(", ")}, got ${b.kind}`,
      });
    }
  }
}

interface Candidate {
  id: string;
  importance: IRFragment["importance"];
  origin?: Origin;
  required: boolean;
  order: number;
  region: Region;
  text: string;
  attachments: Attachment[];
  tokens: number;
  reason: TraceReason;
}

interface SessionBlock {
  id: string;
  region: Region;
  text: string;
  tokens: number;
}

function sessionBlocks(
  ctx: RenderContext,
  session: Session,
  labels: Labels,
  counter: TokenCounter,
): SessionBlock[] {
  const blocks: SessionBlock[] = [];
  const add = (id: string, region: Region, lines: string[], header: string) => {
    if (lines.length === 0) return;
    const text = [header, ...lines].join("\n");
    blocks.push({ id, region, text, tokens: counter.count(text) });
  };

  const declared = new Set([USER_LATE_SLOT, ...ctx.ir.late_slots.map((s) => s.key)]);
  const bindingKeys = Object.keys(session.bindings)
    .filter((k) => declared.has(k))
    .sort((a, b) => (a === USER_LATE_SLOT ? -1 : b === USER_LATE_SLOT ? 1 : compareStrings(a, b)));
  add(
    "session:bindings",
    "session:bindings",
    bindingKeys.flatMap((k) => {
      const b = session.bindings[k];
      return b?.description ? [`${b.display_name}: ${b.description}`] : [];
    }),
    labels.bindingsHeader,
  );

  const overlay = session.overlay ?? {};
  add("session:memory", "session:memory", overlay.memory ?? [], labels.memoryHeader);
  add(
    "session:state",
    "session:state",
    Object.keys(overlay.state ?? {})
      .sort(compareStrings)
      .map((k) => `${k}: ${overlay.state?.[k] ?? ""}`),
    labels.stateHeader,
  );
  add(
    "session:variants",
    "session:variants",
    Object.keys(overlay.active_variants ?? {})
      .sort(compareStrings)
      .map((k) => `${k}: ${overlay.active_variants?.[k] ?? ""}`),
    labels.variantsHeader,
  );
  return blocks;
}

export function renderPrepared(input: PreparedRenderInput): AssembleResult {
  const ir = parseOrThrow(ContextIRSchema, input.ir, "ir");
  const profile = parseOrThrow(RuntimeProfileSchema, input.profile, "profile");
  const session = parseOrThrow(SessionSchema, input.session, "session");
  const preset = parseOrThrow(ResolvedPresetSchema, input.preset, "preset");
  if (
    profile.capabilities.system_role !== true ||
    (preset.policy.requires.multiple_system_messages === true &&
      profile.capabilities.multiple_system_messages !== true)
  ) {
    throw new CharError({
      code: "assemble.preset_incompatible",
      subject: preset.ref,
      detail: "the runtime must explicitly support the preset's required message capabilities",
    });
  }
  const counter = input.counter ?? estimateCounter;
  const labels = input.labels ?? DEFAULT_LABELS;

  checkLateBindings(ir, session);
  const locale = chooseLocale(ir, profile, session);
  const ctx = new RenderContext(ir, session, locale, profile.capabilities.images === true, labels);
  const forParticipant = session.for_participant ?? SELF_PARTICIPANT;
  if (
    (profile.mode === "per-agent" || session.for_participant !== undefined) &&
    !ctx.hasParticipant(forParticipant)
  ) {
    throw new CharError({ code: "assemble.unknown_participant", subject: forParticipant });
  }

  // 1. Render only content admitted by the shared Catalog/Plan pipeline.
  const entries = new Map<string, TraceEntry>();
  const candidates: Candidate[] = [];
  const entry = (
    f: { id: string; origin?: Origin },
    region: Region,
    decision: TraceEntry["decision"],
    reason: TraceReason,
    tokens = 0,
  ): void => {
    entries.set(f.id, {
      id: f.id,
      region,
      tokens,
      decision,
      reason,
      ...(f.origin ? { origin: f.origin } : {}),
    });
  };

  for (const f of ir.fragments) {
    const admission = input.prepared.fragments.get(f.id);
    const region = admission?.region ?? regionFor(f);
    if (!admission) {
      entry(f, region, "skipped", "inactive");
      continue;
    }
    const rendered = ctx.render(f);
    if (rendered.empty) {
      if (admission.required)
        throw new CharError({ code: "assemble.required_unrenderable", subject: f.id });
      entry(f, region, "skipped", "unsupported-media");
      continue;
    }
    const text = admission.prefix ? `${admission.prefix}\n${rendered.text}` : rendered.text;
    const reason: TraceReason = rendered.localeFallback
      ? "locale-fallback"
      : rendered.mediaDegraded
        ? "unsupported-media"
        : admission.reason;
    candidates.push({
      id: f.id,
      importance: f.importance,
      origin: f.origin,
      required: admission.required,
      order: admission.order,
      region,
      text,
      attachments: rendered.attachments,
      tokens: counter.count(text),
      reason,
    });
  }

  for (const extra of input.prepared.extra) {
    candidates.push({
      ...extra,
      importance: "normal",
      attachments: [],
      tokens: counter.count(extra.text),
    });
  }

  // Style presentation order is independent of selector rank and budget admission.
  // Only reorder Style slots: unrelated fragments retain their original positions.
  const styles = new Map(ir.fragments.filter((f) => f.style_scope).map((f) => [f.id, f]));
  const owners = new Map<string, number>();
  for (const f of styles.values())
    if (f.style_use && !owners.has(f.style_use.owner)) owners.set(f.style_use.owner, owners.size);
  const scopeOrder = (f: IRFragment) =>
    f.style_scope === "narration" ? 0 : f.style_scope && "scene" in f.style_scope ? 1 : 2;
  const useOrder = (left: IRFragment, right: IRFragment) => {
    const a = left.style_use ? [left.style_use, ...(left.style_use.path ?? [])] : [];
    const b = right.style_use ? [right.style_use, ...(right.style_use.path ?? [])] : [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const difference = (a[i]?.order ?? 0) - (b[i]?.order ?? 0);
      if (difference) return difference;
    }
    return a.length - b.length;
  };
  const styleCandidates = candidates
    .flatMap((candidate) => {
      const fragment = styles.get(candidate.id);
      return fragment ? [{ candidate, fragment }] : [];
    })
    .sort(({ fragment: left }, { fragment: right }) => {
      return (
        scopeOrder(left) - scopeOrder(right) ||
        (owners.get(left.style_use?.owner ?? "") ?? 0) -
          (owners.get(right.style_use?.owner ?? "") ?? 0) ||
        useOrder(left, right)
      );
    });
  let styleIndex = 0;
  const presentation = candidates.map((c) =>
    styles.has(c.id) ? (styleCandidates[styleIndex++]?.candidate ?? c) : c,
  );

  // 2. 固定成本：对话历史与 Session 内容总是纳入。
  const history = session.history.map((m) => {
    const content =
      m.speaker === undefined ? m.text : `${ctx.participantName(m.speaker)}: ${m.text}`;
    return { role: m.role, content, tokens: counter.count(content) };
  });
  const historyTokens = history.reduce((n, m) => n + m.tokens, 0);
  const blocks = sessionBlocks(ctx, session, labels, counter);
  const policyBlocks = preset.policy.blocks.map((b) => ({
    ...b,
    source: `preset:${b.id}`,
    tokens: b.enabled === false ? 0 : counter.count(b.text),
  }));
  const fixed =
    historyTokens +
    blocks.reduce((n, b) => n + b.tokens, 0) +
    policyBlocks.reduce((n, b) => n + b.tokens, 0);
  const inputBudget = profile.context_window - profile.reserve_for_output;
  const available = inputBudget - fixed;
  const makeMessages = (chosen: Set<Candidate>): AssembledMessage[] => {
    const systemRole = "system";
    const renderRegion = (region: Region): AssembledMessage | undefined => {
      const parts: string[] = [];
      const source: string[] = [];
      const attachments: Attachment[] = [];
      for (const b of blocks) {
        if (b.region !== region) continue;
        parts.push(b.text);
        source.push(b.id);
      }
      const inRegion = presentation.filter((c) => c.region === region && chosen.has(c));
      if (region === "system:examples" && inRegion.length > 0) parts.push(labels.examplesHeader);
      for (const c of inRegion) {
        // 只有图片的 fragment 没有文本，但仍然要作为来源记录，并带上它的附件。
        if (c.text.length > 0) parts.push(c.text);
        source.push(c.id);
        attachments.push(...c.attachments);
      }
      if (source.length === 0) return undefined;
      const msg: AssembledMessage = { role: systemRole, content: parts.join("\n\n"), source };
      if (attachments.length > 0) msg.attachments = attachments;
      return msg;
    };
    const historyMessages: AssembledMessage[] = history.map((m) => ({
      role: m.role,
      content: m.content,
      source: ["history"],
    }));
    let messages: AssembledMessage[];
    const policyMessages = (position: "main" | "after-history"): AssembledMessage[] =>
      policyBlocks
        .filter((b) => b.enabled !== false && b.position === position)
        .map((b) => ({ role: "system", content: b.text, source: [b.source] }));
    messages = policyMessages("main");
    for (const region of preset.policy.layout) {
      if (region === "history") messages.push(...historyMessages);
      else {
        const msg = renderRegion(region);
        if (msg) messages.push(msg);
      }
    }
    messages.push(...policyMessages("after-history"));
    if (profile.capabilities.multiple_system_messages !== true) {
      messages = mergeAdjacentSystemMessages(messages);
      if (messages.filter((m) => m.role === "system").length > 1) {
        throw new CharError({
          code: "assemble.preset_incompatible",
          subject: preset.ref,
          detail: "system messages separated by history require multiple_system_messages",
        });
      }
    }
    return messages;
  };
  // 取逐来源成本与最终消息文本成本中的较大值，避免合并分隔符和区域标题漏计。
  const presetCost = (chosen: Set<Candidate>): number => {
    const sourceTokens = fixed + [...chosen].reduce((n, c) => n + c.tokens, 0);
    const messageTokens = makeMessages(chosen).reduce((n, m) => n + counter.count(m.content), 0);
    return Math.max(sourceTokens, messageTokens);
  };
  const fixedInputCost = presetCost(new Set());
  if (fixedInputCost > inputBudget) {
    throw new CharError({
      code: "assemble.fixed_over_budget",
      subject: preset.ref,
      detail: "history, session content and enabled policy blocks exceed the input budget",
      data: { fixed_tokens: fixedInputCost, input_budget: inputBudget },
    });
  }

  // 3. 预算：pinned 必须全部放下；其余按 normal → opportunistic、IR 顺序整条纳入或跳过。
  const pinned = candidates.filter((c) => c.required || c.importance === "pinned");
  const pinnedTokens = pinned.reduce((n, c) => n + c.tokens, 0);
  const pinnedInputCost = presetCost(new Set(pinned));
  if (pinnedInputCost > inputBudget) {
    throw new CharError({
      code:
        pinned.some((c) => c.importance !== "pinned") &&
        presetCost(new Set(pinned.filter((c) => c.importance === "pinned"))) <= inputBudget
          ? "assemble.required_over_budget"
          : "assemble.pinned_over_budget",
      subject: ir.root.ref,
      detail: "fixed content, required fragments and message formatting exceed the input budget",
      data: {
        pinned_tokens: pinnedTokens,
        available,
        fragments: pinned.map((c) => c.id),
        required_input_tokens: pinnedInputCost,
        input_budget: inputBudget,
      },
    });
  }
  const included = new Set<Candidate>(pinned);
  const regionUsage = new Map<Region, number>();
  const regionLimit = (region: Region) => preset.policy.region_budgets?.[region as CreativeRegion];
  for (const c of pinned) {
    const used = (regionUsage.get(c.region) ?? 0) + c.tokens;
    regionUsage.set(c.region, used);
    const limit = regionLimit(c.region);
    if (limit !== undefined && used > limit) {
      throw new CharError({
        code: "assemble.preset_region_over_budget",
        subject: c.region,
        detail: "pinned fragments exceed the preset's region budget",
        data: { pinned_tokens: used, limit },
      });
    }
  }
  // Required/direct/selected admission order is the single budget priority.
  const orderedCandidates = [...candidates].sort((a, b) => a.order - b.order);
  let remaining = available - pinnedTokens;
  for (const tier of ["normal", "opportunistic"] as const) {
    for (const c of orderedCandidates) {
      if (c.importance !== tier || included.has(c)) continue;
      const used = regionUsage.get(c.region) ?? 0;
      const limit = regionLimit(c.region);
      if (c.tokens <= remaining && (limit === undefined || used + c.tokens <= limit)) {
        included.add(c);
        if (presetCost(included) > inputBudget) {
          included.delete(c);
          continue;
        }
        remaining -= c.tokens;
        regionUsage.set(c.region, used + c.tokens);
      }
    }
  }
  for (const c of candidates) {
    if (included.has(c)) entry(c, c.region, "included", c.reason, c.tokens);
    else entry(c, c.region, "skipped", "budget", c.tokens);
  }

  const messages = makeMessages(included);
  const formattingTokens = Math.max(
    0,
    messages.reduce((n, m) => n + counter.count(m.content), 0) -
      fixed -
      [...included].reduce((n, c) => n + c.tokens, 0),
  );

  // 5. Trace：fragment 按 IR 顺序，随后是 Session 内容与对话历史。
  const traceEntries: TraceEntry[] = ir.fragments.map((f) => {
    const e = entries.get(f.id);
    if (!e) throw new CharError({ code: "assemble.internal", subject: f.id });
    return e;
  });
  for (const extra of input.prepared.extra) {
    const item = entries.get(extra.id);
    if (item) traceEntries.push(item);
  }
  for (const b of blocks) {
    traceEntries.push({
      id: b.id,
      region: b.region,
      tokens: b.tokens,
      decision: "included",
      reason: "always",
    });
  }
  if (history.length > 0) {
    traceEntries.push({
      id: "history",
      region: "history",
      tokens: historyTokens,
      decision: "included",
      reason: "always",
    });
  }
  for (const b of policyBlocks) {
    traceEntries.push({
      id: b.source,
      region: `preset:${b.position}`,
      tokens: b.tokens,
      decision: b.enabled === false ? "skipped" : "included",
      reason: b.enabled === false ? "inactive" : "always",
      ...(b.origin ? { policy_origin: b.origin } : {}),
      ...(b.placement ? { policy_placement: b.placement } : {}),
      ...(b.purpose ? { purpose: b.purpose } : {}),
    });
  }
  if (formattingTokens > 0) {
    traceEntries.push({
      id: "assembly:formatting",
      region: "assembly:formatting",
      tokens: formattingTokens,
      decision: "included",
      reason: "always",
    });
  }
  const total = traceEntries.reduce((n, e) => (e.decision === "included" ? n + e.tokens : n), 0);

  return {
    messages,
    trace: {
      ir: {
        root: ir.root.ref,
        ...buildIdentity(ir.root),
        semantic_digest: ir.root.semantic_digest,
        lock_digest: ir.lock_digest,
      },
      assembler: { ...ASSEMBLER, layout: "preset-v1" },
      preset: {
        ref: preset.ref,
        ...buildIdentity(preset),
        semantic_digest: preset.semantic_digest,
        resolver: preset.resolver,
      },
      profile: {
        tokenizer: counter.tokenizer,
        context_window: profile.context_window,
        mode: profile.mode,
      },
      total_tokens: total,
      estimated: counter.estimated,
      entries: traceEntries,
    },
  };
}

/** 只合并相邻 system 消息；绝不把历史前后的指令挪到同一个位置。 */
function mergeAdjacentSystemMessages(messages: AssembledMessage[]): AssembledMessage[] {
  const result: AssembledMessage[] = [];
  let run: AssembledMessage[] = [];
  const flush = () => {
    if (run.length > 0)
      result.push(run.length === 1 ? (run[0] as AssembledMessage) : mergeMessages(run, "system"));
    run = [];
  };
  for (const message of messages) {
    if (message.role === "system") run.push(message);
    else {
      flush();
      result.push(message);
    }
  }
  flush();
  return result;
}

function mergeMessages(list: AssembledMessage[], role: AssembledMessage["role"]): AssembledMessage {
  const attachments = list.flatMap((m) => m.attachments ?? []);
  const merged: AssembledMessage = {
    role,
    content: list.map((m) => m.content).join("\n\n"),
    source: list.flatMap((m) => m.source),
  };
  if (attachments.length > 0) merged.attachments = attachments;
  return merged;
}
