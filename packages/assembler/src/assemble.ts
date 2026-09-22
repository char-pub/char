/**
 * 参考 Assembler：把 Context IR、Runtime Profile 和 Session 组装成发给模型的消息，并输出
 * 解释每个决定的 Assembly Trace。
 *
 * Assembler 只能对 IR 做选择、排序、跳过和叠加 Session 内容，不能改写 fragment 内容；
 * 唯一的例外是替换 late 占位符。没有 Preset 时使用下面的默认布局。
 *
 * 默认布局（region 名即 trace 中的 region）：
 *
 *   system:character     根角色自己的设定（placement_hint 为 character，subject 为 self 或未指定）
 *   system:cast          其他角色的设定
 *   session:bindings     Session 绑定对象（用户 Persona 等）的描述
 *   system:persona / system:world / system:scenario / system:relationship
 *   system:knowledge / system:style / system:instruction
 *   system:examples      示例对话，放在对话历史之前
 *   session:memory / session:state / session:variants   Session Overlay
 *   history              对话历史
 *
 * 预算：可用预算 = context_window − reserve_for_output − 对话历史 − Session 内容。
 * pinned 永远纳入，pinned 本身超出预算时报错；其余先 normal、后 opportunistic，同组内按
 * IR 顺序，放得下就整条纳入，放不下就整条跳过，不截断任何 fragment。
 *
 * Trace 中每个 IR fragment 恰好一条记录。纳入时 reason 默认是激活原因（always / pinned /
 * keyword:<key> / manual）；如果内容回退到了默认 locale，reason 记为 locale-fallback；
 * 如果图片被换成了 alt 文本，reason 记为 unsupported-media。回退比降级优先，这样 Preview
 * 能提示“这条内容不是用户选择的语言”。
 */
import {
  type AssemblyTrace,
  CharError,
  type ContextIR,
  ContextIRSchema,
  compareStrings,
  type IRFragment,
  type Origin,
  type RuntimeProfile,
  RuntimeProfileSchema,
  SELF_PARTICIPANT,
  USER_LATE_SLOT,
} from "@char-pub/core";
import type { z } from "zod";
import { evaluateActivation } from "./activation.js";
import { matchLocale } from "./locale.js";
import { type Attachment, DEFAULT_LABELS, type Labels, RenderContext } from "./render.js";
import { type Session, type SessionInput, SessionSchema } from "./session.js";
import { estimateCounter, type TokenCounter } from "./tokens.js";

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

export interface AssembleInput {
  ir: ContextIR;
  profile: RuntimeProfile;
  session: SessionInput;
  /** Preset 的结构尚未定义；目前只支持默认布局。 */
  preset?: undefined;
  /** 已加载的 tokenizer，缺省使用估算。 */
  counter?: TokenCounter;
  labels?: Labels;
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

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, subject: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new CharError({
      code: "assemble.invalid_input",
      subject,
      detail: first ? `${first.path.join(".") || "$"}: ${first.message}` : "invalid",
    });
  }
  return r.data;
}

/** 选择组装使用的 locale：Session 优先，其次 Runtime Profile，最后 IR 的默认 locale。 */
export function chooseLocale(ir: ContextIR, profile: RuntimeProfile, session: Session): string {
  return session.locale ?? profile.locale ?? ir.meta.default_locale;
}

/** visibility.to 里的写法统一成 participant key（兼容带 `participant:` 前缀的写法）。 */
function participantKeyOf(target: string): string {
  return target.startsWith("participant:") ? target.slice("participant:".length) : target;
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
  fragment: IRFragment;
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

export function assemble(input: AssembleInput): AssembleResult {
  const ir = parseOrThrow(ContextIRSchema, input.ir, "ir");
  const profile = parseOrThrow(RuntimeProfileSchema, input.profile, "profile");
  const session = parseOrThrow(SessionSchema, input.session, "session");
  const counter = input.counter ?? estimateCounter;
  const labels = input.labels ?? DEFAULT_LABELS;

  checkLateBindings(ir, session);
  const locale = chooseLocale(ir, profile, session);
  const ctx = new RenderContext(ir, session, locale, profile.capabilities.images === true, labels);
  const forParticipant = session.for_participant ?? SELF_PARTICIPANT;
  if (!ctx.hasParticipant(forParticipant)) {
    throw new CharError({ code: "assemble.unknown_participant", subject: forParticipant });
  }
  const manual = new Set(session.manual_enabled ?? []);

  // 1. 逐个 fragment 判定可见性与激活，渲染候选并计数。
  const entries = new Map<string, TraceEntry>();
  const candidates: Candidate[] = [];
  const entry = (
    f: IRFragment,
    region: Region,
    decision: TraceEntry["decision"],
    reason: TraceReason,
    tokens = 0,
  ): void => {
    entries.set(f.id, { id: f.id, region, tokens, decision, reason, origin: f.origin as Origin });
  };

  for (const f of ir.fragments) {
    const region = regionFor(f);
    const vis = f.visibility;
    let privateTo: string[] | null = null;
    if (vis.scope === "private") {
      const keys = vis.to.map(participantKeyOf);
      if (profile.mode === "per-agent" && !keys.includes(forParticipant)) {
        entry(f, region, "skipped", "visibility");
        continue;
      }
      privateTo = keys;
    } else if (vis.scope === "scene" && vis.scene !== session.scene) {
      entry(f, region, "skipped", "visibility");
      continue;
    }

    const act = evaluateActivation(
      f.activation,
      f.importance === "pinned",
      manual.has(f.id),
      session.history,
    );
    if (!act.active) {
      entry(f, region, "skipped", act.reason);
      continue;
    }

    const rendered = ctx.render(f);
    if (rendered.empty) {
      entry(f, region, "skipped", "unsupported-media");
      continue;
    }
    let text = rendered.text;
    // narrator 模式下 private 内容仍然交给模型，但必须说明只有哪些角色知道。
    // 这只是扮演提示，不是隔离；需要隔离时 Runtime 应使用 per-agent 模式。
    if (privateTo !== null && profile.mode === "narrator") {
      text = `${labels.privateNote(privateTo.map((k) => ctx.participantName(k)))}\n${text}`;
    }
    const reason: TraceReason = rendered.localeFallback
      ? "locale-fallback"
      : rendered.mediaDegraded
        ? "unsupported-media"
        : act.reason;
    candidates.push({
      fragment: f,
      region,
      text,
      attachments: rendered.attachments,
      tokens: counter.count(text),
      reason,
    });
  }

  // 2. 固定成本：对话历史与 Session 内容总是纳入。
  const history = session.history.map((m) => {
    const content =
      m.speaker === undefined ? m.text : `${ctx.participantName(m.speaker)}: ${m.text}`;
    return { role: m.role, content, tokens: counter.count(content) };
  });
  const historyTokens = history.reduce((n, m) => n + m.tokens, 0);
  const blocks = sessionBlocks(ctx, session, labels, counter);
  const fixed = historyTokens + blocks.reduce((n, b) => n + b.tokens, 0);
  const available = profile.context_window - profile.reserve_for_output - fixed;

  // 3. 预算：pinned 必须全部放下；其余按 normal → opportunistic、IR 顺序整条纳入或跳过。
  const pinned = candidates.filter((c) => c.fragment.importance === "pinned");
  const pinnedTokens = pinned.reduce((n, c) => n + c.tokens, 0);
  if (pinnedTokens > available) {
    throw new CharError({
      code: "assemble.pinned_over_budget",
      subject: ir.root.ref,
      detail: `pinned fragments need ${pinnedTokens} tokens, only ${Math.max(0, available)} available`,
      data: { pinned_tokens: pinnedTokens, available, fragments: pinned.map((c) => c.fragment.id) },
    });
  }
  const included = new Set<Candidate>(pinned);
  let remaining = available - pinnedTokens;
  for (const tier of ["normal", "opportunistic"] as const) {
    for (const c of candidates) {
      if (c.fragment.importance !== tier) continue;
      if (c.tokens <= remaining) {
        included.add(c);
        remaining -= c.tokens;
      }
    }
  }
  for (const c of candidates) {
    if (included.has(c)) entry(c.fragment, c.region, "included", c.reason, c.tokens);
    else entry(c.fragment, c.region, "skipped", "budget", c.tokens);
  }

  // 4. 按默认布局生成消息。
  const systemRole = profile.capabilities.system_role === false ? "user" : "system";
  const regionMessages: AssembledMessage[] = [];
  for (const region of SYSTEM_REGION_ORDER) {
    const parts: string[] = [];
    const source: string[] = [];
    const attachments: Attachment[] = [];
    for (const b of blocks) {
      if (b.region !== region) continue;
      parts.push(b.text);
      source.push(b.id);
    }
    const inRegion = candidates.filter((c) => c.region === region && included.has(c));
    if (region === "system:examples" && inRegion.length > 0) parts.push(labels.examplesHeader);
    for (const c of inRegion) {
      // 只有图片的 fragment 没有文本，但仍然要作为来源记录，并带上它的附件。
      if (c.text.length > 0) parts.push(c.text);
      source.push(c.fragment.id);
      attachments.push(...c.attachments);
    }
    if (source.length === 0) continue;
    const msg: AssembledMessage = { role: systemRole, content: parts.join("\n\n"), source };
    if (attachments.length > 0) msg.attachments = attachments;
    regionMessages.push(msg);
  }
  const messages =
    profile.capabilities.multiple_system_messages === false && regionMessages.length > 1
      ? [mergeMessages(regionMessages, systemRole)]
      : regionMessages;
  for (const m of history) messages.push({ role: m.role, content: m.content, source: ["history"] });

  // 5. Trace：fragment 按 IR 顺序，随后是 Session 内容与对话历史。
  const traceEntries: TraceEntry[] = ir.fragments.map((f) => {
    const e = entries.get(f.id);
    if (!e) throw new CharError({ code: "assemble.internal", subject: f.id });
    return e;
  });
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
  const total = traceEntries.reduce((n, e) => (e.decision === "included" ? n + e.tokens : n), 0);

  return {
    messages,
    trace: {
      ir: { root: ir.root.ref, lock_digest: ir.lock_digest },
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

// ---------------------------------------------------------------------------
// Session 开场
// ---------------------------------------------------------------------------

export interface StartSessionOptions {
  /** 使用哪一条问候语，缺省为第一条。 */
  greetingId?: string;
  locale?: string;
}

export interface OpeningMessage {
  role: "assistant";
  content: string;
  /** 说话的 participant key。 */
  speaker: string;
  greeting_id: string;
  /** 请求的 locale 没有对应的问候语译文，使用了默认文本。 */
  locale_fallback: boolean;
}

/**
 * Session 开始时的首条 assistant 消息。问候语不参与上下文预算，
 * 由 Runtime 在创建 Session 时调用一次。
 */
export function startSession(
  irInput: ContextIR,
  sessionInput: SessionInput,
  opts: StartSessionOptions = {},
): OpeningMessage {
  const ir = parseOrThrow(ContextIRSchema, irInput, "ir");
  const session = parseOrThrow(SessionSchema, sessionInput, "session");
  checkLateBindings(ir, session);
  const greetings = ir.bootstrap.greetings;
  const g =
    opts.greetingId === undefined ? greetings[0] : greetings.find((x) => x.id === opts.greetingId);
  if (!g) {
    throw new CharError({ code: "assemble.no_greeting", subject: opts.greetingId ?? ir.root.ref });
  }
  const locale = opts.locale ?? session.locale ?? ir.meta.default_locale;
  const ctx = new RenderContext(ir, session, locale, false, DEFAULT_LABELS);
  const def = ir.meta.default_locale;
  const variants = g.locales ?? {};
  const pick = matchLocale([def, ...Object.keys(variants).sort(compareStrings)], locale);
  const raw = pick === null || pick === def ? g.text : (variants[pick] ?? g.text);
  return {
    role: "assistant",
    content: ctx.text(raw),
    speaker: participantKeyOf(g.speaker),
    greeting_id: g.id,
    locale_fallback: pick === null,
  };
}
