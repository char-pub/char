/**
 * 角色卡文本与 Canonical 模板文本之间的转换。
 *
 * 角色卡里的宏（CBS）不区分大小写：`{{char}}` 对应 Canonical 的 `{{self}}`，`{{user}}` 保持不变；
 * 旧格式的 `<BOT>`、`<CHAR>`、`<USER>` 也按同样规则转换。其他宏（`{{random:…}}`、`{{roll:…}}`、
 * 注释等）在 Canonical 模型中没有对应物，导入时转义为字面量（`{{` 写成 `{{{{`），并记录下来，
 * 这样内容不会丢失，也不会被当成占位符执行。
 */
import { sha256Hex } from "@char-pub/core";

export interface PlaceholderNote {
  /** 在卡片中的位置，例如 `data.description`、`character_book.entries[3].content`。 */
  location: string;
  placeholder: string;
}

const LEGACY_TAGS: Record<string, "{{self}}" | "{{user}}"> = {
  "<bot>": "{{self}}",
  "<char>": "{{self}}",
  "<user>": "{{user}}",
};

/**
 * 把角色卡文本转换成 Canonical 模板文本。
 * 返回的文本中只会出现 `{{self}}`、`{{user}}` 两种占位符，其余 `{{` 都已转义。
 */
export function cardTextToTemplate(
  text: string,
  location: string,
  notes: PlaceholderNote[],
): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "<") {
      const close = text.indexOf(">", i);
      if (close > i && close - i <= 5) {
        const tag = text.slice(i, close + 1).toLowerCase();
        const mapped = LEGACY_TAGS[tag];
        if (mapped) {
          out += mapped;
          i = close + 1;
          continue;
        }
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "{" && text[i + 1] === "{") {
      const end = text.indexOf("}}", i + 2);
      if (end < 0) {
        // 没有闭合的 `{{`：整段按字面量保留
        out += escapeBraces(text.slice(i));
        break;
      }
      const inner = text.slice(i + 2, end);
      const key = inner.trim().toLowerCase();
      if (key === "char") out += "{{self}}";
      else if (key === "user") out += "{{user}}";
      else {
        notes.push({ location, placeholder: `{{${inner}}}` });
        out += `{{{{${escapeBraces(inner)}}}`;
      }
      i = end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function escapeBraces(s: string): string {
  return s.replaceAll("{{", "{{{{");
}

// ---------------------------------------------------------------------------
// 派生 fragment ID 的 slug
// ---------------------------------------------------------------------------

/**
 * 把任意名字转换成合法的 fragment ID 段：小写 ASCII 字母数字，其他字符折叠成 `-`，
 * 首尾必须是字母或数字，最长 48 个字符。没有可用的 ASCII 字符（例如纯中文名字）时，
 * 用名字的 sha256 前 12 位加前缀 `h`，保证同样的名字总是得到同样的 ID。
 */
export function slugSegment(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return ascii.length > 0 ? ascii : `h${sha256Hex(name).slice(0, 12)}`;
}

/** 在 `used` 中为 `base` 找一个未占用的 ID：`base`、`base-2`、`base-3`……并登记。 */
export function allocateId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Lorebook 条目内容开头的 decorator（`@@name value`）
// ---------------------------------------------------------------------------

export interface Decorator {
  name: string;
  value: string;
  /** `@@@` 开头的后备 decorator：只有前一个 decorator 不被识别时才生效。 */
  fallback: boolean;
}

/** 拆出内容开头连续的 decorator 行，返回剩余正文（去掉开头的空行）。 */
export function splitDecorators(content: string): { decorators: Decorator[]; body: string } {
  const lines = content.split(/\r\n|\r|\n/);
  const decorators: Decorator[] = [];
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  for (; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const m = /^(@@@?)([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/.exec(line);
    if (!m) break;
    decorators.push({ name: m[2] ?? "", value: (m[3] ?? "").trim(), fallback: m[1] === "@@@" });
  }
  if (decorators.length === 0) return { decorators, body: content };
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  return { decorators, body: lines.slice(i).join("\n") };
}

// ---------------------------------------------------------------------------
// 示例对话（mes_example）
// ---------------------------------------------------------------------------

export interface DialogueBlock {
  turns: { speaker: "{{self}}" | "{{user}}"; text: string }[];
}

const SPEAKER_PREFIX = /^\s*(\{\{\s*(char|user)\s*\}\}|<(bot|char|user)>)\s*:\s?/i;

/**
 * 按 `<START>` 分段并解析说话人。每一轮以 `{{char}}:` 或 `{{user}}:` 开头，后续不带前缀的行
 * 属于同一轮。任何一段在第一个说话人之前有正文、或者没有任何一轮时，返回 null，
 * 调用方应当把整段示例当作普通文本导入。
 */
export function parseExampleDialogue(text: string): DialogueBlock[] | null {
  const blocks = text
    .split(/^\s*<start>\s*$/im)
    .map((b) => b.replace(/^\s*\n|\n\s*$/g, ""))
    .filter((b) => b.trim() !== "");
  if (blocks.length === 0) return null;
  const out: DialogueBlock[] = [];
  for (const block of blocks) {
    const turns: DialogueBlock["turns"] = [];
    for (const line of block.split(/\r\n|\r|\n/)) {
      const m = SPEAKER_PREFIX.exec(line);
      if (m) {
        const who = (m[2] ?? m[3] ?? "").toLowerCase();
        turns.push({
          speaker: who === "user" ? "{{user}}" : "{{self}}",
          text: line.slice(m[0].length),
        });
        continue;
      }
      const last = turns[turns.length - 1];
      if (!last) {
        if (line.trim() === "") continue;
        return null;
      }
      last.text += `\n${line}`;
    }
    for (const t of turns) t.text = t.text.replace(/\s+$/, "");
    if (turns.length === 0) return null;
    out.push({ turns });
  }
  return out;
}
