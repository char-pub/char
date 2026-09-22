/**
 * 模板文本解析。模板只支持纯值替换，没有条件、循环或表达式：
 *
 *   {{self}}            当前 Creation 所指的角色
 *   {{user}}            Session 的用户角色（late binding）
 *   {{slot:<name>}}     slot 绑定对象的显示名
 *   {{param:<name>}}    param 的值
 *   {{late:<key>}}      只出现在 Context IR 中：由 Assembler 在 Session 开始时替换
 *
 * 转义：字面量 `{{` 写成 `{{{{`。连续的 `{` 按 4 个一组还原成字面量 `{{`，剩下的：
 * 1 个是字面量 `{`；2 个开始一个占位符；3 个是字面量 `{` 加一个占位符。
 * 这样 `{` 紧挨着占位符（`{{{self}}`）也没有歧义。单独出现的 `}}` 就是普通文本。
 */
import { CharError } from "./errors.js";
import { PARAM_NAME_RE, SLOT_NAME_RE } from "./ids.js";

export type TemplateToken =
  | { t: "text"; v: string }
  | { t: "self" }
  | { t: "user" }
  | { t: "slot"; name: string }
  | { t: "param"; name: string }
  | { t: "late"; key: string };

export type TemplateMode = "creation" | "ir";

export interface TemplateIssue {
  code: "template.unknown_placeholder" | "template.unclosed" | "template.invalid_name";
  offset: number;
  detail: string;
}

const LATE_KEY_RE = /^(?:user|l:[0-9a-f]{64})$/;

/**
 * 把模板文本拆成 token。遇到非法占位符不抛异常，而是记录到 issues 并把原文当作文本，
 * 这样 check 可以一次报告所有问题。
 */
export function tokenizeTemplate(
  text: string,
  mode: TemplateMode = "creation",
): { tokens: TemplateToken[]; issues: TemplateIssue[] } {
  const tokens: TemplateToken[] = [];
  const issues: TemplateIssue[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) tokens.push({ t: "text", v: buf });
    buf = "";
  };
  while (i < text.length) {
    if (text[i] !== "{") {
      buf += text[i];
      i += 1;
      continue;
    }
    let run = 0;
    while (text[i + run] === "{") run += 1;
    buf += "{{".repeat(Math.floor(run / 4));
    const rest = run % 4;
    if (rest === 0 || rest === 1) {
      if (rest === 1) buf += "{";
      i += run;
      continue;
    }
    if (rest === 3) buf += "{";
    i += run - 2;
    const end = text.indexOf("}}", i + 2);
    if (end < 0) {
      issues.push({ code: "template.unclosed", offset: i, detail: "missing '}}'" });
      buf += text.slice(i);
      break;
    }
    const inner = text.slice(i + 2, end);
    const tok = parsePlaceholder(inner, mode);
    if (typeof tok === "string") {
      issues.push({
        code: tok === "name" ? "template.invalid_name" : "template.unknown_placeholder",
        offset: i,
        detail: `{{${inner}}}`,
      });
      buf += text.slice(i, end + 2);
    } else {
      flush();
      tokens.push(tok);
    }
    i = end + 2;
  }
  flush();
  return { tokens, issues };
}

function parsePlaceholder(inner: string, mode: TemplateMode): TemplateToken | "unknown" | "name" {
  if (inner === "self" && mode === "creation") return { t: "self" };
  if (inner === "user" && mode === "creation") return { t: "user" };
  const colon = inner.indexOf(":");
  if (colon < 0) return "unknown";
  const kind = inner.slice(0, colon);
  const name = inner.slice(colon + 1);
  if (mode === "creation") {
    if (kind === "slot") return SLOT_NAME_RE.test(name) ? { t: "slot", name } : "name";
    if (kind === "param") return PARAM_NAME_RE.test(name) ? { t: "param", name } : "name";
    return "unknown";
  }
  if (kind === "late") return LATE_KEY_RE.test(name) ? { t: "late", key: name } : "name";
  return "unknown";
}

/** 解析模板；有任何问题就抛出第一个。 */
export function parseTemplate(text: string, mode: TemplateMode = "creation"): TemplateToken[] {
  const { tokens, issues } = tokenizeTemplate(text, mode);
  const first = issues[0];
  if (first) {
    throw new CharError({
      code: first.code,
      subject: `offset:${first.offset}`,
      detail: first.detail,
    });
  }
  return tokens;
}

/** 把字面量文本转义回模板形式（`{{` → `{{{{`）。 */
export function escapeTemplateText(s: string): string {
  return s.replaceAll("{{", "{{{{");
}

/** 原样插入的模板片段（例如 `{{late:user}}`），不做转义。 */
export interface RawTemplate {
  raw: string;
}

/**
 * 按 token 重新拼出文本。`resolve` 返回替换后的字面量（会被转义）、`{ raw }`（原样插入），
 * 或 null（保留占位符原样）。输出总是合法的模板。
 */
export function renderTemplate(
  tokens: readonly TemplateToken[],
  resolve: (tok: Exclude<TemplateToken, { t: "text" }>) => string | RawTemplate | null,
): string {
  let out = "";
  for (const tok of tokens) {
    if (tok.t === "text") {
      out += escapeTemplateText(tok.v);
      continue;
    }
    const v = resolve(tok);
    if (v === null) out += placeholderText(tok);
    else if (typeof v === "string") out += escapeTemplateText(v);
    else out += v.raw;
  }
  return out;
}

export function placeholderText(tok: Exclude<TemplateToken, { t: "text" }>): string {
  switch (tok.t) {
    case "self":
      return "{{self}}";
    case "user":
      return "{{user}}";
    case "slot":
      return `{{slot:${tok.name}}}`;
    case "param":
      return `{{param:${tok.name}}}`;
    case "late":
      return `{{late:${tok.key}}}`;
  }
}

/** 把 IR 文本中的 `{{late:*}}` 替换掉，并把转义的 `{{{{` 还原为 `{{`，得到最终给模型的纯文本。 */
export function finalizeIrText(text: string, bindLate: (key: string) => string): string {
  const tokens = parseTemplate(text, "ir");
  let out = "";
  for (const tok of tokens) {
    if (tok.t === "text") out += tok.v;
    else if (tok.t === "late") out += bindLate(tok.key);
  }
  return out;
}
