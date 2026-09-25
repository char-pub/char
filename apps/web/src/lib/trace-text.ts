/**
 * Assembly Trace 的人话：每一行“为什么进入（或没进入）上下文”、放在哪里、来自哪条依赖、
 * 被谁改过。原始的 reason code（`keyword:Arasaka`、`inactive`……）只作为次要信息另外显示。
 */
import type { AssemblyTrace, ContextIR, IRFragment } from "@char-pub/core";
import { dependenciesOf, MODE_LABEL, nodeOf, relPhrase } from "./creation-graph";

export type TraceEntry = AssemblyTrace["entries"][number];

const quote = (s: string) => `“${s}”`;

function lowerFirst(s: string): string {
  return s.replace(/^./, (c) => c.toLowerCase());
}

/** 这段内容是根作品直接依赖带来的时候，说明是哪条依赖，例如“Alice lives in Night City (Core)”。 */
function becauseOf(ir: ContextIR, f: IRFragment | undefined): string | null {
  if (!f || f.origin.creation === ir.root.ref) return null;
  const dep = dependenciesOf(ir).find((d) => d.ref === f.origin.creation);
  if (!dep?.direct) return null;
  const root = nodeOf(ir, ir.root.ref)?.name ?? ir.root.ref;
  const how = dep.rel ? lowerFirst(relPhrase(dep.rel, dep.name)) : `is built on ${dep.name}`;
  return `${root} ${how}${dep.mode ? ` (${MODE_LABEL[dep.mode]})` : ""}`;
}

/** 表格里“Why”一列：一句话。 */
export function whyShort(ir: ContextIR, e: TraceEntry, f: IRFragment | undefined): string {
  const r = e.reason;
  if (e.id === "assembly:formatting")
    return "Message separators and generated headings add to the final text cost.";
  if (e.id.startsWith("preset:"))
    return e.decision === "included"
      ? "Enabled by the selected preset."
      : "Disabled in the selected preset.";
  if (r.startsWith("keyword:")) return `The chat mentions ${quote(r.slice("keyword:".length))}.`;
  if (e.id === "history") return "The conversation so far.";
  if (e.id.startsWith("session:")) return "Part of this session.";
  switch (r) {
    case "always": {
      const because = becauseOf(ir, f);
      return because ? `Always included, because ${because}.` : "Always included.";
    }
    case "pinned":
      return "Pinned — never cut to save space.";
    case "manual":
      return "You enabled it by hand.";
    case "semantic":
      return "Needs semantic search, which this preview doesn't run.";
    case "budget":
      return "Didn't fit in the context window.";
    case "visibility":
      return "Hidden from this participant.";
    case "locale-fallback":
      return "Included in the default language: it has no text in the session's language.";
    case "unsupported-media":
      return "Left out: this runtime can't show images.";
    case "inactive": {
      const a = f?.activation;
      if (a?.mode === "keyword") {
        return `Not triggered — the chat doesn't mention ${a.keys.map(quote).join(" or ")}.`;
      }
      if (a?.mode === "manual") return "Off until you enable it by hand.";
      return "Not triggered.";
    }
    default:
      return r;
  }
}

/** 展开行里的“Why now”：比表格里多说一点。 */
export function whyLong(ir: ContextIR, e: TraceEntry, f: IRFragment | undefined): string {
  const r = e.reason;
  if (r.startsWith("keyword:")) {
    return `Keyword ${quote(r.slice("keyword:".length))} matched the recent chat, so this passage switched on.`;
  }
  switch (r) {
    case "pinned":
      return "It is pinned: it always goes in and is never cut, even when space runs out.";
    case "budget":
      return "It was switched on, but what was left of the context window after the chat and the pinned passages wasn't enough for it. Passages are never cut in half.";
    case "visibility":
      return "It is private to another character, and in per-agent mode each character only sees its own private passages.";
    default:
      return whyShort(ir, e, f);
  }
}

const SECTION: Record<string, string> = {
  character: "the character",
  cast: "the other characters",
  persona: "personas",
  world: "the world",
  scenario: "the scenario",
  relationship: "relationships",
  knowledge: "background knowledge",
  style: "style",
  instruction: "instructions",
};

/** “Where”一列：短说法。 */
export function whereShort(region: string): string {
  if (region === "assembly:formatting") return "formatting";
  if (region.startsWith("preset:")) return "policy";
  if (region === "history") return "chat";
  if (region === "system:examples") return "examples";
  if (region.startsWith("session:")) return "session";
  if (region.startsWith("system:")) return "system";
  return region;
}

/** 展开行里的“Placed”。 */
export function whereLong(region: string): string {
  if (region === "history") return "In the chat history.";
  if (region === "preset:main") return "Before every context region.";
  if (region === "preset:after-history") return "After every context region.";
  if (region === "assembly:formatting") return "Final message text; not a separate message.";
  if (region === "system:examples")
    return "In the examples region. Its actual position is shown in Messages.";
  if (region === "session:bindings")
    return "In the system prompt, where the session describes who you are.";
  if (region.startsWith("session:")) return "In the session part of the system prompt.";
  const section = SECTION[region.slice("system:".length)];
  return section ? `In the system prompt, in the part about ${section}.` : `In ${region}.`;
}

/** 展开行里的“From”。 */
export function fromText(ir: ContextIR, e: TraceEntry, f: IRFragment | undefined): string {
  const origin = e.origin ?? f?.origin;
  if (!origin) {
    if (e.id === "assembly:formatting")
      return "Additional text created when the selected layout renders messages.";
    if (e.id.startsWith("preset:")) return "The selected preset or its locked prompt modules.";
    if (e.id === "history") return "The chat history you typed in the session panel.";
    if (e.id.startsWith("session:")) return "The persona you set in the session panel.";
    return "The session.";
  }
  const node = nodeOf(ir, origin.creation);
  const name = node?.name ?? origin.creation;
  if (origin.creation === ir.root.ref)
    return `${name}'s own passage ${quote(`#${origin.fragment}`)}.`;
  const path = origin.via.map(quote).join(" → ");
  return `${name} (${origin.creation}), passage ${quote(`#${origin.fragment}`)}${path ? `, through the ${path} reference` : ""}.`;
}

const OP_TEXT = { replace: "replaced it", patch: "changed it", add: "added it" } as const;

/** 展开行里的“Overridden by”；没有被改过时返回 null。 */
export function overriddenText(
  ir: ContextIR,
  e: TraceEntry,
  f: IRFragment | undefined,
): string | null {
  const list = (e.origin ?? f?.origin)?.overridden_by ?? [];
  if (list.length === 0) return null;
  return list
    .map((o) => {
      const name = nodeOf(ir, o.creation)?.name ?? o.creation;
      return `${name} ${OP_TEXT[o.op]}${o.edge ? ` through its ${quote(o.edge)} reference` : ""}`;
    })
    .join("; ")
    .replace(/^./, (c) => c.toUpperCase())
    .concat(".");
}
