/**
 * 在人工审阅之前，对 draft 中的 Context IR 做一遍机器可查的规范检查，帮审阅人把注意力
 * 放在语义上。它**不能**代替人工审阅：通过预检只说明输出没有违反这些不变量。
 *
 * 检查项：
 * - 按 schema 解析；JCS 序列化与文件内容逐字节一致；
 * - 各数组按规范排序（participants / late_slots 按 key，assets 按 id，graph.nodes 按 ref，
 *   graph.instances 按 via，graph.edges 按 from_instance + id，graph.removed 按 id，
 *   content_warnings 按字典序，diagnostics 按 code + subject）；
 * - 每个 IR fragment 的 digest 可以由它的语义字段重新算出，ID 与 origin 一致；
 * - instance key 与 via 路径一致，participant / late slot 之间没有悬空引用；
 * - 文本里的 `{{late:*}}` 都指向存在的 late slot，且出现在 used_by 中；
 * - IR 中没有带签名参数的 URL。
 */
import {
  ContextIRSchema,
  compareStrings,
  instanceKey,
  irFragmentDigest,
  irFragmentId,
  type JSONValue,
  jcs,
} from "@char-pub/core";

type Issue = string;

function sorted<T>(list: readonly T[], key: (x: T) => string): boolean {
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (a !== undefined && b !== undefined && compareStrings(key(a), key(b)) > 0) return false;
  }
  return true;
}

export function precheck(text: string): Issue[] {
  const issues: Issue[] = [];
  const raw = JSON.parse(text) as unknown;
  const parsed = ContextIRSchema.safeParse(raw);
  if (!parsed.success) return [`schema: ${parsed.error.issues[0]?.message}`];
  const ir = parsed.data;
  if (jcs(raw as JSONValue) !== text.replace(/\n$/, "")) issues.push("file is not canonical JCS");

  if (!sorted(ir.participants, (p) => p.key)) issues.push("participants not sorted by key");
  if (!sorted(ir.late_slots, (s) => s.key)) issues.push("late_slots not sorted by key");
  if (!sorted(ir.assets, (a) => a.id)) issues.push("assets not sorted by id");
  if (!sorted(ir.graph.nodes, (n) => n.ref)) issues.push("graph.nodes not sorted by ref");
  if (!sorted(ir.graph.instances, (i) => jcs(i.via)))
    issues.push("graph.instances not sorted by via");
  if (!sorted(ir.graph.edges, (e) => `${e.from_instance}\u0000${e.id}`)) {
    issues.push("graph.edges not sorted by from_instance + id");
  }
  if (!sorted(ir.graph.removed, (r) => r.id)) issues.push("graph.removed not sorted by id");
  if (!sorted(ir.meta.content_warnings, (w) => w)) issues.push("content_warnings not sorted");
  if (!sorted(ir.diagnostics, (d) => `${d.code}\u0000${d.subject}`))
    issues.push("diagnostics not sorted");

  const instances = new Map(ir.graph.instances.map((i) => [i.key, i]));
  for (const i of ir.graph.instances) {
    if (instanceKey(i.via) !== i.key) issues.push(`instance ${i.key}: key does not match via`);
  }
  const slotKeys = new Set(ir.late_slots.map((s) => s.key));
  for (const p of ir.participants) {
    if (p.late !== undefined && !slotKeys.has(p.late))
      issues.push(`participant ${p.key}: dangling late ${p.late}`);
  }
  const participantKeys = new Set(ir.participants.map((p) => p.key));
  const assetIds = new Set(ir.assets.map((a) => a.id));
  const usedBy = new Map(ir.late_slots.map((s) => [s.key, new Set(s.used_by)]));

  const lateRefs = (s: string) =>
    [...s.matchAll(/(?<!\{)\{\{late:([^}]+)\}\}/g)].map((m) => m[1] ?? "");
  const checkText = (owner: string, s: string) => {
    for (const k of lateRefs(s)) {
      if (!slotKeys.has(k)) issues.push(`${owner}: {{late:${k}}} has no late slot`);
      else if (!usedBy.get(k)?.has(owner)) issues.push(`${owner}: not listed in used_by of ${k}`);
    }
  };

  for (const f of ir.fragments) {
    const { id, origin, digest, ...semantic } = f;
    if (irFragmentDigest(semantic) !== digest) issues.push(`${id}: digest mismatch`);
    if (irFragmentId(origin.creation, origin.fragment, origin.instance_key) !== id) {
      issues.push(`${id}: id does not match origin`);
    }
    const inst = instances.get(origin.instance_key);
    if (!inst) issues.push(`${id}: unknown instance`);
    else if (jcs(inst.via) !== jcs(origin.via))
      issues.push(`${id}: origin.via differs from instance`);
    if (f.subject !== undefined && !participantKeys.has(f.subject))
      issues.push(`${id}: unknown subject`);
    for (const a of f.asset_refs ?? [])
      if (!assetIds.has(a)) issues.push(`${id}: unknown asset ${a}`);
    if (f.visibility.scope === "private") {
      for (const t of f.visibility.to) {
        if (!participantKeys.has(t.replace(/^participant:/, "")))
          issues.push(`${id}: unknown visibility target ${t}`);
      }
    }
    const contents = [f.content, ...Object.values(f.locales ?? {})];
    for (const c of contents) {
      if (c.type === "text") checkText(id, c.text);
      if (c.type === "media" && c.caption) checkText(id, c.caption);
      if (c.type === "dialogue") {
        for (const t of c.turns) {
          checkText(id, t.text);
          if (!participantKeys.has(t.speaker.replace(/^participant:/, ""))) {
            issues.push(`${id}: unknown speaker ${t.speaker}`);
          }
        }
      }
    }
  }
  for (const g of ir.bootstrap.greetings) {
    checkText(`bootstrap:${g.id}`, g.text);
    for (const t of Object.values(g.locales ?? {})) checkText(`bootstrap:${g.id}`, t);
  }
  for (const s of ir.late_slots) {
    for (const u of s.used_by) {
      if (!u.startsWith("bootstrap:") && !ir.fragments.some((f) => f.id === u)) {
        issues.push(`late slot ${s.key}: used_by ${u} is not a fragment`);
      }
    }
  }
  if (/[?&](X-Amz-|Signature=|sig=|token=)/i.test(text)) issues.push("IR contains a signed URL");
  return issues;
}
