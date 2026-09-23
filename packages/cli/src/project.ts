/**
 * 读取与写回 `char.yaml`。
 *
 * `char.yaml` 就是 Canonical Creation 的 YAML 表示，外加几条书写便利：
 * - 文本字段写成 `./xxx.md` 或 `./xxx.txt` 时，读取同目录下的文件内容；
 * - fragment 可以省略 `stable`（默认 true）；省略 `id` 时由 `char check --fix` 生成并写回；
 * - 内部 Creation ID 可以省略，本地构建使用由 ref 派生的占位 ID。
 *
 * YAML 是不可信输入：只接受 JSON 兼容的 core schema，限制别名展开次数和文件大小，
 * 被引用的文件不能跳出项目根目录。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CharError, sha256Hex } from "@char-pub/core";
import { type Document, isMap, isSeq, parseDocument, type YAMLMap } from "yaml";

export const MAX_YAML_BYTES = 2 * 1024 * 1024;
export const MAX_INCLUDE_BYTES = 1024 * 1024;
const MAX_ALIAS_COUNT = 100;

const INCLUDE_RE = /^\.\/[^\s]+\.(md|txt)$/;

/** 本地构建使用的占位 Creation ID：由 ref 确定性派生，格式合法但不会与 Registry 分配的 ID 冲突。 */
export function placeholderCreationId(ref: string): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const hex = sha256Hex(`char.pub/local/${ref}`);
  let out = "0";
  for (let i = 0; i < 25; i++) {
    const n = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    out += alphabet[n % 32];
  }
  return `cr_${out}`;
}

export interface LoadedProject {
  file: string;
  root: string;
  /** 原始 YAML 文档，`check --fix` 在它上面修改，尽量保留作者的格式和注释。 */
  doc: Document;
  /** 展开 include 与默认值之后、canonicalize 之前的 Creation。 */
  creation: Record<string, unknown>;
  /** 缺少 id 的 fragment 在文档中的下标。 */
  missingIds: number[];
  /** 是否使用了占位 Creation ID。 */
  placeholderId: boolean;
}

/**
 * 读取一个仓库内文件的函数。`rel` 是相对于项目根目录、已经规范化的路径；
 * 文件不存在时返回 null。本地文件系统与 GitHub 仓库各有一个实现。
 */
export type FileReader = (rel: string) => Promise<Uint8Array | null>;

export interface ParsedCharYaml {
  doc: Document;
  creation: Record<string, unknown>;
  missingIds: number[];
  placeholderId: boolean;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * 解析 char.yaml 并展开 include。与文件系统无关：CLI 从本地目录读取，Registry 从 GitHub
 * 的某个 commit 读取，两者得到的 Creation 完全相同，所以算出的 digest 也相同。
 *
 * @param yamlPath char.yaml 相对于项目根目录的路径
 */
export async function parseCharYaml(
  bytes: Uint8Array,
  yamlPath: string,
  read: FileReader,
): Promise<ParsedCharYaml> {
  if (bytes.byteLength > MAX_YAML_BYTES) {
    throw new CharError({ code: "cli.file_too_large", subject: yamlPath });
  }
  const text = (() => {
    try {
      return decoder.decode(bytes);
    } catch {
      throw new CharError({
        code: "cli.yaml_invalid",
        subject: yamlPath,
        detail: "not valid UTF-8",
      });
    }
  })();
  const doc = parseDocument(text, {
    schema: "core",
    customTags: [],
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (doc.errors.length > 0) {
    throw new CharError({
      code: "cli.yaml_invalid",
      subject: yamlPath,
      detail: doc.errors[0]?.message ?? "",
    });
  }
  const value = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CharError({ code: "cli.yaml_not_object", subject: yamlPath });
  }
  const creation = value as Record<string, unknown>;
  const dir = path.posix.dirname(yamlPath);
  await expandIncludes(creation, dir, read);

  const missingIds: number[] = [];
  const fragments = creation.fragments;
  if (Array.isArray(fragments)) {
    fragments.forEach((f, i) => {
      if (f && typeof f === "object" && !Array.isArray(f)) {
        const frag = f as Record<string, unknown>;
        if (frag.stable === undefined) frag.stable = true;
        if (frag.id === undefined) missingIds.push(i);
      }
    });
  }
  let placeholderId = false;
  if (creation.id === undefined && typeof creation.ref === "string") {
    creation.id = placeholderCreationId(creation.ref);
    placeholderId = true;
  }
  return { doc, creation, missingIds, placeholderId };
}

export async function loadCharYaml(file: string, projectRoot?: string): Promise<LoadedProject> {
  const abs = path.resolve(file);
  const root = path.resolve(projectRoot ?? path.dirname(abs));
  const read: FileReader = async (rel) => {
    const buf = await readFile(path.join(root, ...rel.split("/"))).catch(() => null);
    return buf ? new Uint8Array(buf) : null;
  };
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const parsed = await parseCharYaml(new Uint8Array(await readFile(abs)), rel, read);
  return { file: abs, root, ...parsed };
}

/** 把 include 引用解析成项目根目录下的规范化路径；跳出根目录时报错。 */
export function resolveInclude(ref: string, dir: string): string {
  const joined = path.posix.normalize(path.posix.join(dir, ref));
  if (joined.startsWith("../") || joined === ".." || path.posix.isAbsolute(joined)) {
    throw new CharError({ code: "cli.include_outside_project", subject: ref });
  }
  return joined;
}

async function expandIncludes(node: unknown, dir: string, read: FileReader): Promise<void> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string" && INCLUDE_RE.test(v)) node[i] = await readInclude(v, dir, read);
      else await expandIncludes(v, dir, read);
    }
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && INCLUDE_RE.test(v)) obj[k] = await readInclude(v, dir, read);
      else await expandIncludes(v, dir, read);
    }
  }
}

async function readInclude(ref: string, dir: string, read: FileReader): Promise<string> {
  const target = resolveInclude(ref, dir);
  const bytes = await read(target);
  if (!bytes) throw new CharError({ code: "cli.include_missing", subject: ref });
  if (bytes.byteLength > MAX_INCLUDE_BYTES) {
    throw new CharError({ code: "cli.include_too_large", subject: ref });
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new CharError({ code: "cli.include_invalid", subject: ref, detail: "not valid UTF-8" });
  }
}

/** fragment ID 的一段：小写字母数字，中间可以有 `-` / `_`，1–64 个字符。 */
function slugSegment(s: string): string {
  const ascii = s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return ascii;
}

/**
 * 为缺少 id 的 fragment 生成稳定 ID：优先由 kind 和内容开头派生可读的名字，
 * 无法派生时（例如全是中文）使用内容哈希前缀；与已有 ID 冲突时追加序号。
 * 同样的输入总是得到同样的 ID，所以重复运行 `--fix` 结果不变。
 */
export function generateFragmentIds(
  fragments: readonly Record<string, unknown>[],
  missing: readonly number[],
): Map<number, string> {
  const taken = new Set(
    fragments.map((f) => f.id).filter((id): id is string => typeof id === "string"),
  );
  const out = new Map<number, string>();
  for (const i of missing) {
    const f = fragments[i] ?? {};
    const kind = typeof f.kind === "string" ? f.kind : "fragment";
    const content = f.content as { text?: unknown } | undefined;
    const text = typeof content?.text === "string" ? content.text : JSON.stringify(f.content ?? "");
    const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
    let base = slugSegment(firstLine.split(/\s+/).slice(0, 4).join(" "));
    if (base.length < 2) base = sha256Hex(text).slice(0, 8);
    const prefix = kind === "knowledge" ? "lore" : kind;
    let id = `${prefix}/${base}`;
    for (let n = 2; taken.has(id); n++) id = `${prefix}/${base}-${n}`;
    taken.add(id);
    out.set(i, id);
  }
  return out;
}

/** 把生成的 ID 写回 YAML 文档（放在 fragment 的第一个键），保留其余格式和注释。 */
export function writeIdsIntoDocument(doc: Document, ids: Map<number, string>): void {
  const fragments = doc.get("fragments", true);
  if (!isSeq(fragments)) return;
  for (const [i, id] of ids) {
    const item = fragments.items[i];
    if (!isMap(item)) continue;
    const map = item as YAMLMap;
    const pair = doc.createPair("id", id);
    map.items.unshift(pair as (typeof map.items)[number]);
  }
}
