/**
 * 手写的 Context IR 测试数据。所有 ID、key 和 digest 都用 core 的函数计算，
 * `buildIR` 最后会用 ContextIRSchema 校验，保证 fixture 本身是合法的 IR。
 */
import {
  type Activation,
  type ContextIR,
  ContextIRSchema,
  type IRAsset,
  type IRContent,
  type IRFragment,
  type IRVisibility,
  instanceKey,
  irAssetId,
  irFragmentDigest,
  irFragmentId,
  type LateSlot,
  type Participant,
  type RuntimeProfile,
} from "@char-pub/core";
import type { TokenCounter } from "../../src/tokens.js";

export const ROOT_REF = "@djj/alice";
export const RELEASE = "rel_01h455vb4pex5vsknk084sn001";
export const DEP_RELEASE = "rel_01h455vb4pex5vsknk084sn002";
export const DIGEST = `sha256:${"a".repeat(64)}`;

/** 每个字符算 1 个 token，便于精确构造预算场景。 */
export const charCounter: TokenCounter = {
  tokenizer: "chars",
  estimated: false,
  count: (text) => text.length,
};

export interface FragOpts {
  fid: string;
  ref?: string;
  via?: string[];
  kind?: IRFragment["kind"];
  text?: string;
  content?: IRContent;
  locales?: Record<string, IRContent>;
  activation?: Activation;
  visibility?: IRVisibility;
  importance?: IRFragment["importance"];
  placement_hint?: IRFragment["placement_hint"];
  subject?: string;
  asset_refs?: string[];
}

export function text(t: string): IRContent {
  return { type: "text", text: t, format: "markdown" };
}

export function frag(o: FragOpts): IRFragment {
  const ref = o.ref ?? ROOT_REF;
  const via = o.via ?? [];
  const inst = instanceKey(via);
  const kind = o.kind ?? "character";
  const semantic = {
    kind,
    content: o.content ?? text(o.text ?? `${o.fid} text`),
    activation: o.activation ?? { mode: "always" as const },
    visibility: o.visibility ?? { scope: "shared" as const },
    importance: o.importance ?? "normal",
    placement_hint: o.placement_hint ?? kind,
    ...(o.locales !== undefined ? { locales: o.locales } : {}),
    ...(o.subject !== undefined ? { subject: o.subject } : {}),
    ...(o.asset_refs !== undefined ? { asset_refs: o.asset_refs } : {}),
  };
  return {
    id: irFragmentId(ref, o.fid, inst),
    ...semantic,
    origin: {
      creation: ref,
      release: ref === ROOT_REF ? RELEASE : DEP_RELEASE,
      fragment: o.fid,
      via,
      instance_key: inst,
      stable: true,
    },
    digest: irFragmentDigest(semantic),
  };
}

export function asset(o: {
  slot: string;
  variant?: string;
  role: IRAsset["role"];
  alt?: string;
}): IRAsset {
  const variant = o.variant ?? "default";
  const a: IRAsset = {
    id: irAssetId(ROOT_REF, o.slot, variant, "root"),
    role: o.role,
    media_type: "image/webp",
    digest: DIGEST,
    availability: "mirrored",
    access: "public",
    url: `https://assets.char.pub/cas/sha256/aa/${"a".repeat(64)}`,
    rating: "general",
    license: "CC-BY-4.0",
    origin: { creation: ROOT_REF, release: RELEASE, slot: o.slot, variant, instance_key: "root" },
  };
  if (o.alt !== undefined) a.alt = o.alt;
  return a;
}

export const SELF: Participant = {
  key: "self",
  ref: ROOT_REF,
  display_name: "Alice",
  kind: "character",
};

export function userSlot(usedBy: string[] = []): LateSlot {
  return { key: "user", accepts: ["persona"], required: true, used_by: usedBy };
}

export interface IROpts {
  fragments: IRFragment[];
  participants?: Participant[];
  late_slots?: LateSlot[];
  assets?: IRAsset[];
  greetings?: ContextIR["bootstrap"]["greetings"];
  default_locale?: string;
}

export function buildIR(o: IROpts): ContextIR {
  const ir: ContextIR = {
    ir_version: "0-draft",
    root: { ref: ROOT_REF, release: RELEASE, semantic_digest: DIGEST },
    lock_digest: `sha256:${"b".repeat(64)}`,
    resolver: { name: "test", version: "0.0.0" },
    meta: {
      default_locale: o.default_locale ?? "en",
      available_locales: [o.default_locale ?? "en"],
      rating: "general",
      rating_sources: [{ ref: ROOT_REF, rating: "general" }],
      content_warnings: [],
      licenses: [{ ref: ROOT_REF, license: "CC-BY-4.0" }],
      attribution: [{ ref: ROOT_REF, authors: [{ name: "djj" }] }],
      contributors: [],
      import_omissions: [],
      au: false,
      recommended_presets: [],
    },
    participants: o.participants ?? [SELF],
    late_slots: o.late_slots ?? [userSlot()],
    fragments: o.fragments,
    bootstrap: {
      greetings: o.greetings ?? [
        { id: "default", speaker: "participant:self", text: "Hi, {{late:user}}." },
      ],
    },
    assets: o.assets ?? [],
    graph: {
      nodes: [{ ref: ROOT_REF, release: RELEASE, type: "character", display_name: "Alice" }],
      instances: [{ key: "root", ref: ROOT_REF, via: [] }],
      edges: [],
      removed: [],
    },
    diagnostics: [],
  };
  return ContextIRSchema.parse(ir);
}

export function profile(o: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    runtime: { name: "test", version: "0" },
    tokenizer: "estimate",
    context_window: 100_000,
    reserve_for_output: 0,
    mode: "narrator",
    capabilities: {},
    ...o,
  };
}

export const USER = { kind: "persona" as const, display_name: "Kai" };
