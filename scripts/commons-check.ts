/**
 * `@commons` 种子内容的校验（`pnpm commons:check`）。
 *
 * 读取 `content/commons` 下的每个 `char.yaml`（包括 `examples/` 下的示例角色），按依赖顺序
 * 模拟一次完整发布：先发布没有依赖的 World 与 Lorebook，再把其他 Creation 中
 * `pin: { follow: latest }` 的 edge 固定到刚刚“发布”的 Release，然后对每个 Creation 运行与
 * Registry 相同的发布校验（`checkPublish`）。全部通过时打印 ref、类型、条目数与 semantic
 * digest；任何一项失败都以非零状态退出。
 *
 * 这里的 Release ID 由 ref 确定性派生，只用于本地校验，真正发布时由 Registry 分配。
 * 发布校验不把任何 namespace 当作“同一权利人”：种子内容必须是任何人都能再分发的。
 *
 * 另外检查种子内容自己的约定：许可为 CC0-1.0、评级为 general、署名为 char.pub commons、
 * 正文里没有链接或邮箱地址。
 *
 * `--json` 输出完整结果（REVIEW.md 中的 digest 表由它生成）。
 * `--snapshots <dir>` 把每个通过校验的 Creation 写成 Release 快照（与 `char build --dep` 的
 * 输入格式相同），并为有依赖的 Creation 写一份 pin 已固定的 `<name>.pinned.yaml`（内容是 JSON，
 * JSON 也是合法的 YAML），便于用 `char build` / `char preview` 在本地构建示例角色。
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCharYaml } from "../packages/cli/src/project.js";
import {
  type CanonicalCreation,
  canonicalizeCreation,
  checkPublish,
  parseCreationRef,
  type ReleaseInput,
  sha256Hex,
} from "../packages/core/src/index.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTENT = path.join(ROOT, "content", "commons");
const LABEL = "1.0.0";
const LICENSE = "CC0-1.0";
const AUTHOR = "char.pub commons";
/** 正文中不应出现的内容：链接与邮箱地址。 */
const FORBIDDEN_TEXT = [/https?:\/\//i, /\bwww\./i, /[\w.+-]+@[\w-]+\.[\w.]+/];

/** 由 ref 派生的本地 Release ID：TypeID 格式合法，不会与 Registry 分配的 ID 冲突。 */
function localReleaseId(ref: string): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const hex = sha256Hex(`char.pub/commons-check/${ref}`);
  let out = "0";
  for (let i = 0; i < 25; i++)
    out += alphabet[Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 32];
  return `rel_${out}`;
}

async function findCharYamls(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(dir)).sort()) {
    const p = path.join(dir, entry);
    if (!(await stat(p)).isDirectory()) continue;
    const yaml = path.join(p, "char.yaml");
    if (
      await stat(yaml).then(
        () => true,
        () => false,
      )
    )
      out.push(yaml);
    else out.push(...(await findCharYamls(p)));
  }
  return out;
}

interface Entry {
  file: string;
  raw: Record<string, unknown>;
  creation: CanonicalCreation;
}

interface Result {
  ref: string;
  type: string;
  file: string;
  fragments: number;
  keyword: number;
  references: string[];
  semantic_digest: string;
  ok: boolean;
  issues: string[];
  /** 通过校验时的 Release 快照与 pin 已固定的 Creation。 */
  snapshot?: ReleaseInput & { semantic_digest: string };
}

/** edge 的 `use`（`@ns/name`、`@ns/name@label` 或同一 namespace 内的 `#name`）对应的不带版本的 ref。 */
function refOf(use: string, owner: string): string {
  if (use.startsWith("#")) return `@${parseCreationRef(owner)?.namespace}/${use.slice(1)}`;
  const p = parseCreationRef(use);
  if (!p) throw new Error(`${owner}: invalid reference ${use}`);
  return `@${p.namespace}/${p.name}`;
}

/** 种子内容自己的约定。返回违反的条目，空数组表示全部满足。 */
function policyIssues(c: CanonicalCreation): string[] {
  const out: string[] = [];
  if (c.meta.license !== LICENSE)
    out.push(`policy license is ${c.meta.license}, expected ${LICENSE}`);
  if (c.meta.rating !== "general") out.push(`policy rating is ${c.meta.rating}, expected general`);
  if (!(c.authors ?? []).some((a) => a.name === AUTHOR))
    out.push(`policy authors must include ${AUTHOR}`);
  const texts: [string, string][] = [];
  for (const f of c.fragments) {
    if (f.content.type === "text") texts.push([f.id, f.content.text]);
    if (f.content.type === "dialogue") for (const t of f.content.turns) texts.push([f.id, t.text]);
  }
  for (const g of c.bootstrap?.greetings ?? []) texts.push([`greeting ${g.id}`, g.text]);
  for (const [where, text] of texts) {
    if (FORBIDDEN_TEXT.some((re) => re.test(text)))
      out.push(`policy ${where} contains a link or an email address`);
  }
  return out;
}

/** 按依赖顺序排列：被引用的 Creation 先于引用它的 Creation。有环时报错。 */
function topoSort(entries: Map<string, Entry>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (ref: string, trail: string[]) => {
    if (state.get(ref) === "done") return;
    if (state.get(ref) === "visiting")
      throw new Error(`dependency cycle: ${[...trail, ref].join(" → ")}`);
    state.set(ref, "visiting");
    const e = entries.get(ref);
    for (const edge of e?.creation.references ?? []) {
      const dep = refOf(edge.use, ref);
      if (!entries.has(dep))
        throw new Error(`${ref} references ${dep}, which is not in content/commons`);
      visit(dep, [...trail, ref]);
    }
    state.set(ref, "done");
    order.push(ref);
  };
  for (const ref of [...entries.keys()].sort()) visit(ref, []);
  return order;
}

export async function checkCommons(): Promise<Result[]> {
  const files = await findCharYamls(CONTENT);
  const entries = new Map<string, Entry>();
  for (const file of files) {
    const project = await loadCharYaml(file);
    if (project.missingIds.length > 0) {
      throw new Error(
        `${path.relative(ROOT, file)}: fragments without an id; run 'char check --fix'`,
      );
    }
    const { creation } = canonicalizeCreation(project.creation);
    if (entries.has(creation.ref)) throw new Error(`duplicate ref ${creation.ref}`);
    entries.set(creation.ref, { file, raw: project.creation, creation });
  }

  const published = new Map<string, ReleaseInput & { semantic_digest: string }>();
  const results: Result[] = [];
  for (const ref of topoSort(entries)) {
    const e = entries.get(ref) as Entry;
    // 把草稿中的 follow latest 固定到依赖刚刚发布的 Release。
    const raw = structuredClone(e.raw);
    const edges = (raw.references as Record<string, unknown>[] | undefined) ?? [];
    for (const edge of edges) {
      const dep = published.get(refOf(String(edge.use), ref));
      if (dep) edge.pin = { release: dep.release, semantic_digest: dep.semantic_digest };
    }
    const release = localReleaseId(ref);
    const report = checkPublish({
      release,
      label: LABEL,
      visibility: "public",
      creation: raw,
      dependencies: [...published.values()],
      registry: {
        existingLabels: {},
        assetStatus: {},
        blockedDigests: new Set(),
        ownerNamespaces: new Set(),
      },
    });
    const c = e.creation;
    const policy = policyIssues(c);
    const result: Result = {
      ref,
      type: c.type,
      file: path.relative(ROOT, e.file),
      fragments: c.fragments.length,
      keyword: c.fragments.filter((f) => f.activation?.mode === "keyword").length,
      references: c.references.map((r) => refOf(r.use, ref)),
      semantic_digest: report.semantic_digest ?? "",
      ok: report.ok && policy.length === 0,
      issues: [
        ...report.issues.map(
          (i) => `${i.severity} ${i.code} ${i.subject}${i.detail ? ` — ${i.detail}` : ""}`,
        ),
        ...policy.map((p) => `error ${p}`),
      ],
    };
    if (result.ok && report.semantic_digest) {
      const snapshot = {
        release,
        visibility: "public" as const,
        creation: raw,
        semantic_digest: report.semantic_digest,
      };
      published.set(ref, snapshot);
      result.snapshot = snapshot;
    }
    results.push(result);
  }
  return results.sort((a, b) => a.type.localeCompare(b.type) || a.ref.localeCompare(b.ref));
}

function printTable(results: readonly Result[]): void {
  const w = Math.max(...results.map((r) => r.ref.length));
  for (const r of results) {
    const entries = r.type === "lorebook" ? `${r.keyword} entries` : `${r.fragments} fragments`;
    process.stdout.write(
      `${r.ok ? "ok  " : "FAIL"}  ${r.ref.padEnd(w)}  ${r.type.padEnd(9)}  ${entries.padEnd(12)}  ${r.semantic_digest}\n`,
    );
    for (const i of r.issues) process.stdout.write(`        ${i}\n`);
  }
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(
    `\n${results.length - failed}/${results.length} creations pass the publish checks\n`,
  );
}

async function writeSnapshots(dir: string, results: readonly Result[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const r of results) {
    if (!r.snapshot) continue;
    const name = r.ref.split("/")[1] as string;
    await writeFile(
      path.join(dir, `${name}.release.json`),
      `${JSON.stringify(r.snapshot, null, 2)}\n`,
    );
    if (r.references.length > 0) {
      await writeFile(
        path.join(dir, `${name}.pinned.yaml`),
        `${JSON.stringify(r.snapshot.creation, null, 2)}\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  const results = await checkCommons();
  const i = process.argv.indexOf("--snapshots");
  if (i >= 0) {
    const dir = process.argv[i + 1];
    if (!dir) throw new Error("--snapshots needs a directory");
    await writeSnapshots(path.resolve(dir), results);
  }
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify(
        results.map(({ snapshot: _s, ...r }) => r),
        null,
        2,
      )}\n`,
    );
  else printTable(results);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
