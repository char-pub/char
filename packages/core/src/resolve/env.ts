/**
 * Resolver 第二阶段的绑定环境：为每个引用实例算出它的 slot、param、参与者与 late slot。
 *
 * 规则：
 * - slot 的值来自引入这个实例的 edge 的 `bind`；根实例没有 edge，它的 slot 全部变成
 *   late slot，这样 Relationship 之类的模板本身也能发布。
 * - 非根实例上未绑定的 slot：必需的直接报错；可选的变成 late slot（只在被使用时才必需）。
 * - early binding 指向的 Creation 必须在这张依赖图里（这样它的内容和版本是锁定的），
 *   并且类型要满足 slot 的 `accepts`。
 * - `{{self}}` 绑定指向声明这条 edge 的父实例，父实例必须是 character 或 persona。
 * - `{{cast:k}}` 绑定只能出现在 Scenario 里，指向该 Scenario 的 cast 成员。
 * - param 的值来自 edge 的 `params`，其次是声明里的默认值；类型必须与声明一致。
 */
import { CharError } from "../errors.js";
import {
  instanceKey,
  lateSlotKey,
  participantKey,
  SELF_PARTICIPANT,
  USER_LATE_SLOT,
  USER_PARTICIPANT,
} from "../keys.js";
import type {
  Binding,
  CreationType,
  LocalizedText,
  ScalarValue,
  SlotDecl,
} from "../schema/creation.js";
import { type GraphInstance, type LoadedGraph, resolveUseRef } from "./graph.js";

/** 一个 slot 最终绑定到了什么。 */
export type SlotValue =
  | { kind: "early"; participant: string | null; display_name: LocalizedText; ref: string }
  | { kind: "late"; participant: string; late: string };

export interface ParticipantDraft {
  key: string;
  ref?: string;
  display_name: LocalizedText;
  kind: "character" | "persona";
  role?: "lead" | "support" | "user";
  late?: string;
  /** 用来找头像的实例。 */
  avatarInstance?: GraphInstance;
}

export interface LateSlotDraft {
  key: string;
  accepts: ("persona" | "character")[];
  /** 声明为必需；被使用时也会变成必需。 */
  declaredRequired: boolean;
  hint?: string;
  used_by: Set<string>;
}

export interface InstanceEnv {
  inst: GraphInstance;
  /** 这个实例所代表的参与者；只有 character / persona 实例才有。 */
  participant: string | null;
  slots: Map<string, SlotValue>;
  params: Map<string, ScalarValue>;
  /** Scenario 实例的 cast 成员 → 参与者 key。 */
  cast: Map<string, SlotValue>;
}

export interface Environment {
  envs: Map<GraphInstance, InstanceEnv>;
  participants: Map<string, ParticipantDraft>;
  lateSlots: Map<string, LateSlotDraft>;
  /** 有没有 intrinsic 依赖被强制 override。 */
  au: boolean;
}

/** `#self` 不是合法的 slot / cast 名，用它为“实例本身”生成参与者 key 不会与 slot 冲突。 */
const INSTANCE_SELF = "#self";

const PARTICIPANT_TYPES: readonly CreationType[] = ["character", "persona"];

function acceptsOf(decl: SlotDecl): CreationType[] {
  return Array.isArray(decl.accepts) ? decl.accepts : [decl.accepts];
}

function lateAccepts(decl: SlotDecl): ("persona" | "character")[] {
  return acceptsOf(decl)
    .filter((t): t is "persona" | "character" => t === "persona" || t === "character")
    .sort();
}

function isParticipantType(t: CreationType): t is "character" | "persona" {
  return PARTICIPANT_TYPES.includes(t);
}

export function buildEnvironment(graph: LoadedGraph): Environment {
  const envs = new Map<GraphInstance, InstanceEnv>();
  const participants = new Map<string, ParticipantDraft>();
  const lateSlots = new Map<string, LateSlotDraft>();

  const firstInstanceOf = new Map<string, GraphInstance>();
  for (const inst of graph.instances) {
    if (!firstInstanceOf.has(inst.release.ref)) firstInstanceOf.set(inst.release.ref, inst);
  }

  lateSlots.set(USER_LATE_SLOT, {
    key: USER_LATE_SLOT,
    accepts: ["persona"],
    declaredRequired: true,
    used_by: new Set(),
  });
  participants.set(USER_PARTICIPANT, {
    key: USER_PARTICIPANT,
    display_name: "user",
    kind: "persona",
    role: "user",
    late: USER_LATE_SLOT,
  });

  const addParticipant = (p: ParticipantDraft) => {
    if (!participants.has(p.key)) participants.set(p.key, p);
    return p.key;
  };

  const addLate = (
    key: string,
    accepts: ("persona" | "character")[],
    required: boolean,
    hint?: string,
  ) => {
    if (accepts.length === 0) {
      throw new CharError({
        code: "resolve.slot_not_late_bindable",
        subject: key,
        detail: "only character or persona slots can be bound by the session",
      });
    }
    const slot: LateSlotDraft = { key, accepts, declaredRequired: required, used_by: new Set() };
    if (hint !== undefined) slot.hint = hint;
    lateSlots.set(key, slot);
    return key;
  };

  /** 按 ref 找到图中的 Release，并检查类型。 */
  const earlyTarget = (ref: string, accepts: CreationType[], subject: string) => {
    const rel = graph.byRef.get(ref);
    if (!rel) {
      throw new CharError({
        code: "resolve.binding_not_in_graph",
        subject,
        detail: `${ref} must also be referenced (and pinned) in this graph`,
      });
    }
    if (!accepts.includes(rel.creation.type)) {
      throw new CharError({
        code: "resolve.binding_type_mismatch",
        subject,
        detail: `${ref} is a ${rel.creation.type}, slot accepts ${accepts.join(", ")}`,
      });
    }
    return rel;
  };

  // 先确定每个实例代表的参与者，slot 的 `{{self}}` 绑定要用到父实例的参与者。
  const instanceParticipant = new Map<GraphInstance, string | null>();
  const castEnvs = new Map<GraphInstance, Map<string, SlotValue>>();

  for (const inst of graph.instances) {
    const c = inst.release.creation;
    if (c.type === "scenario") {
      const cast = new Map<string, SlotValue>();
      for (const member of c.cast ?? []) {
        const key = participantKey(inst.key, member.key);
        const subject = `${c.ref}/cast/${member.key}`;
        const who = member.who;
        if (typeof who === "object") {
          const late = addLate(lateSlotKey(inst.key, member.key), [who.late], true, who.hint);
          const p: ParticipantDraft = { key, display_name: member.key, kind: who.late, late };
          if (member.role) p.role = member.role;
          addParticipant(p);
          cast.set(member.key, { kind: "late", participant: key, late });
          continue;
        }
        if (who === "{{self}}" || who.startsWith("{{cast:")) {
          throw new CharError({ code: "resolve.invalid_cast_binding", subject });
        }
        const rel = earlyTarget(resolveUseRef(who, c.ref), ["character", "persona"], subject);
        const kind = rel.creation.type === "persona" ? "persona" : "character";
        const p: ParticipantDraft = {
          key,
          ref: rel.ref,
          display_name: rel.creation.display_name,
          kind,
        };
        if (member.role) p.role = member.role;
        const avatarInstance = firstInstanceOf.get(rel.ref);
        if (avatarInstance) p.avatarInstance = avatarInstance;
        addParticipant(p);
        cast.set(member.key, {
          kind: "early",
          participant: key,
          display_name: rel.creation.display_name,
          ref: rel.ref,
        });
      }
      castEnvs.set(inst, cast);
    }
  }

  for (const inst of graph.instances) {
    const c = inst.release.creation;
    if (!isParticipantType(c.type)) {
      instanceParticipant.set(inst, null);
      continue;
    }
    if (inst === graph.root) {
      instanceParticipant.set(
        inst,
        addParticipant({
          key: SELF_PARTICIPANT,
          ref: c.ref,
          display_name: c.display_name,
          kind: c.type,
          avatarInstance: inst,
        }),
      );
      continue;
    }
    const parent = inst.parent?.instance;
    const parentCast = parent ? castEnvs.get(parent) : undefined;
    let key: string | null = null;
    if (parentCast) {
      for (const v of parentCast.values()) {
        if (v.kind === "early" && v.ref === c.ref) {
          key = v.participant;
          break;
        }
      }
    }
    if (key === null) {
      key = addParticipant({
        key: participantKey(inst.key, INSTANCE_SELF),
        ref: c.ref,
        display_name: c.display_name,
        kind: c.type,
        avatarInstance: inst,
      });
    }
    instanceParticipant.set(inst, key);
  }

  for (const inst of graph.instances) {
    const c = inst.release.creation;
    const edge = inst.parent?.edge;
    const parent = inst.parent?.instance;
    const subjectBase = edge ? `${parent?.release.ref}/${edge.id}` : c.ref;
    const bind = edge?.bind ?? {};
    const declared = c.slots ?? {};

    for (const name of Object.keys(bind)) {
      if (!Object.hasOwn(declared, name)) {
        throw new CharError({
          code: "resolve.slot_unknown",
          subject: `${subjectBase}/bind/${name}`,
        });
      }
    }

    const slots = new Map<string, SlotValue>();
    for (const [name, decl] of Object.entries(declared)) {
      const subject = `${subjectBase}/bind/${name}`;
      const required = decl.required ?? true;
      const b: Binding | undefined = Object.hasOwn(bind, name) ? bind[name] : undefined;
      if (b === undefined) {
        if (edge && required) {
          throw new CharError({ code: "resolve.required_slot_unbound", subject });
        }
        const accepts = lateAccepts(decl);
        if (accepts.length === 0 && !required) continue;
        const late = addLate(lateSlotKey(inst.key, name), accepts, required);
        const pkey = participantKey(inst.key, name);
        addParticipant({ key: pkey, display_name: name, kind: accepts[0] ?? "persona", late });
        slots.set(name, { kind: "late", participant: pkey, late });
        continue;
      }
      slots.set(name, bindSlot(b, decl, subject, inst, name));
    }

    envs.set(inst, {
      inst,
      participant: instanceParticipant.get(inst) ?? null,
      slots,
      params: resolveParams(inst, subjectBase),
      cast: castEnvs.get(inst) ?? new Map(),
    });
  }

  function bindSlot(
    b: Binding,
    decl: SlotDecl,
    subject: string,
    inst: GraphInstance,
    name: string,
  ): SlotValue {
    const accepts = acceptsOf(decl);
    const parent = inst.parent?.instance;
    if (typeof b === "object") {
      if (!accepts.includes(b.late)) {
        throw new CharError({
          code: "resolve.binding_type_mismatch",
          subject,
          detail: `late ${b.late} is not accepted (${accepts.join(", ")})`,
        });
      }
      const late = addLate(lateSlotKey(inst.key, name), [b.late], decl.required ?? true, b.hint);
      const pkey = participantKey(inst.key, name);
      addParticipant({ key: pkey, display_name: b.hint ?? name, kind: b.late, late });
      return { kind: "late", participant: pkey, late };
    }
    if (b === "{{self}}") {
      if (!parent) throw new CharError({ code: "resolve.self_binding_without_parent", subject });
      const pc = parent.release.creation;
      if (!isParticipantType(pc.type) || !accepts.includes(pc.type)) {
        throw new CharError({
          code: "resolve.binding_type_mismatch",
          subject,
          detail: `{{self}} is a ${pc.type}, slot accepts ${accepts.join(", ")}`,
        });
      }
      return {
        kind: "early",
        participant: instanceParticipant.get(parent) ?? null,
        display_name: pc.display_name,
        ref: pc.ref,
      };
    }
    if (b.startsWith("{{cast:")) {
      const key = b.slice("{{cast:".length, -2);
      const castEnv = parent ? castEnvs.get(parent) : undefined;
      const v = castEnv?.get(key);
      if (!v) throw new CharError({ code: "resolve.cast_unknown", subject, detail: key });
      if (v.kind === "early") {
        const rel = earlyTarget(v.ref, accepts, subject);
        return { ...v, display_name: rel.creation.display_name };
      }
      return v;
    }
    const declaringRef = parent?.release.ref ?? inst.release.ref;
    const rel = earlyTarget(resolveUseRef(b, declaringRef), accepts, subject);
    let participant: string | null = null;
    if (isParticipantType(rel.creation.type)) {
      const p: ParticipantDraft = {
        key: participantKey(inst.key, name),
        ref: rel.ref,
        display_name: rel.creation.display_name,
        kind: rel.creation.type,
      };
      const avatarInstance = firstInstanceOf.get(rel.ref);
      if (avatarInstance) p.avatarInstance = avatarInstance;
      participant = addParticipant(p);
    }
    return { kind: "early", participant, display_name: rel.creation.display_name, ref: rel.ref };
  }

  const au = graph.instances.some((i) => i.release.creation.provenance.au === true);
  return { envs, participants, lateSlots, au };
}

function resolveParams(inst: GraphInstance, subjectBase: string): Map<string, ScalarValue> {
  const decls = inst.release.creation.params ?? {};
  const given = inst.parent?.edge.params ?? {};
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(decls, name)) {
      throw new CharError({
        code: "resolve.param_unknown",
        subject: `${subjectBase}/params/${name}`,
      });
    }
  }
  const out = new Map<string, ScalarValue>();
  for (const [name, decl] of Object.entries(decls)) {
    const subject = `${subjectBase}/params/${name}`;
    const value = Object.hasOwn(given, name) ? given[name] : decl.default;
    if (value === undefined) continue;
    if (typeof value !== decl.type) {
      throw new CharError({
        code: "resolve.param_type_mismatch",
        subject,
        detail: `expected ${decl.type}, got ${typeof value}`,
      });
    }
    out.set(name, value);
  }
  return out;
}

/** 从可本地化文本中取某个 locale 的值：先精确匹配，再用 fallback locale，最后取键最小的一项。 */
export function pickLocalized(text: LocalizedText, locale: string, fallback: string): string {
  if (typeof text === "string") return text;
  const exact = text[locale] ?? text[fallback];
  if (exact !== undefined) return exact;
  const keys = Object.keys(text).sort();
  return keys[0] === undefined ? "" : (text[keys[0]] ?? "");
}

export { instanceKey };
