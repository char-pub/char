/**
 * `char` 命令的实现。每个命令都是一个可测试的函数，接收参数和一个输出接口，
 * 返回进程退出码；`bin.ts` 只负责解析命令行并调用它们。
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assemble, createTokenCounter, type SessionInput } from "@char-pub/assembler";
import {
  CharError,
  type CheckDiagnostic,
  canonicalizeCreation,
  checkCreation,
  isCharError,
  type ReleaseInput,
  resolve,
} from "@char-pub/core";
import { stringify } from "yaml";
import { generateFragmentIds, loadCharYaml, writeIdsIntoDocument } from "./project.js";

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

export const consoleOutput: Output = {
  log: (l) => process.stdout.write(`${l}\n`),
  error: (l) => process.stderr.write(`${l}\n`),
};

const LOCAL_RELEASE = "rel_00000000000000000000000000";

function formatDiagnostic(d: CheckDiagnostic): string {
  const tag = d.severity === "error" ? "error" : d.severity === "warning" ? "warn " : "info ";
  return `${tag}  ${d.code}  ${d.subject}${d.detail ? `  — ${d.detail}` : ""}`;
}

function reportError(out: Output, e: unknown): number {
  if (isCharError(e)) {
    out.error(`error  ${e.code}  ${e.subject}${e.detail ? `  — ${e.detail}` : ""}`);
    return 1;
  }
  throw e;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export interface InitOptions {
  dir: string;
  ref: string;
  type: "character" | "world" | "lorebook";
  name: string;
}

const TEMPLATES: Record<InitOptions["type"], (o: InitOptions) => Record<string, unknown>> = {
  character: (o) => ({
    ref: o.ref,
    type: "character",
    display_name: o.name,
    fragments: [
      { id: "description", kind: "character", content: { type: "text", text: "./description.md" } },
    ],
    bootstrap: { greetings: [{ id: "default", text: `Hi, I'm {{self}}.` }] },
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  }),
  world: (o) => ({
    ref: o.ref,
    type: "world",
    display_name: o.name,
    fragments: [{ id: "world", kind: "world", content: { type: "text", text: "./world.md" } }],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  }),
  lorebook: (o) => ({
    ref: o.ref,
    type: "lorebook",
    display_name: o.name,
    fragments: [
      {
        id: "lore/example",
        kind: "knowledge",
        content: { type: "text", text: "Describe something here." },
        activation: { mode: "keyword", keys: ["example"] },
      },
    ],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  }),
};

export async function cmdInit(o: InitOptions, out: Output): Promise<number> {
  const file = path.join(o.dir, "char.yaml");
  if (await exists(file)) {
    out.error(`error  cli.exists  ${file} already exists`);
    return 1;
  }
  await mkdir(o.dir, { recursive: true });
  await writeFile(file, stringify(TEMPLATES[o.type](o)));
  if (o.type === "character") {
    await writeFile(path.join(o.dir, "description.md"), `${o.name} is ...\n`);
  } else if (o.type === "world") {
    await writeFile(path.join(o.dir, "world.md"), "This world is ...\n");
  }
  out.log(`created ${file}`);
  return 0;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

export interface CheckOptions {
  file: string;
  fix?: boolean;
  source?: "github" | "native";
}

export async function cmdCheck(o: CheckOptions, out: Output): Promise<number> {
  try {
    const project = await loadCharYaml(o.file);
    if (project.missingIds.length > 0) {
      if (!o.fix) {
        for (const i of project.missingIds) {
          out.error(`error  check.missing_fragment_id  fragments[${i}]  — run 'char check --fix'`);
        }
        return 1;
      }
      const frags = (project.creation.fragments as Record<string, unknown>[]) ?? [];
      const ids = generateFragmentIds(frags, project.missingIds);
      for (const [i, id] of ids) {
        const f = frags[i];
        if (f) f.id = id;
      }
      writeIdsIntoDocument(project.doc, ids);
      await writeFile(project.file, project.doc.toString());
      out.log(`wrote ${ids.size} fragment id(s) to ${project.file}`);
    }
    const { creation, semantic_digest } = canonicalizeCreation(project.creation);
    const result = checkCreation(creation, o.source ? { source: o.source } : {});
    for (const d of result.diagnostics) {
      (d.severity === "error" ? out.error : out.log)(formatDiagnostic(d));
    }
    if (!result.ok) return 1;
    out.log(`ok  ${creation.ref}  ${semantic_digest}`);
    return 0;
  } catch (e) {
    return reportError(out, e);
  }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export interface BuildOptions {
  file: string;
  /** 依赖 Release 的本地快照（JSON，ReleaseInput 形状），通常由 `char pull` 下载。 */
  deps?: string[];
  outDir: string;
}

async function loadDeps(files: readonly string[]): Promise<ReleaseInput[]> {
  const deps: ReleaseInput[] = [];
  for (const f of files) {
    const v = JSON.parse(await readFile(f, "utf8")) as ReleaseInput;
    deps.push(v);
  }
  return deps;
}

export async function buildLocal(file: string, depFiles: readonly string[] = []) {
  const project = await loadCharYaml(file);
  if (project.missingIds.length > 0) {
    throw new CharError({
      code: "check.missing_fragment_id",
      subject: `fragments[${project.missingIds[0]}]`,
      detail: "run 'char check --fix'",
    });
  }
  const { creation } = canonicalizeCreation(project.creation);
  const check = checkCreation(creation);
  const firstError = check.diagnostics.find((d) => d.severity === "error");
  if (firstError) {
    throw new CharError({
      code: firstError.code,
      subject: firstError.subject,
      ...(firstError.detail ? { detail: firstError.detail } : {}),
    });
  }
  const dependencies = await loadDeps(depFiles);
  const root: ReleaseInput = { release: LOCAL_RELEASE, visibility: "private", creation };
  return { project, creation, resolved: resolve({ root, dependencies }) };
}

export async function cmdBuild(o: BuildOptions, out: Output): Promise<number> {
  try {
    const { resolved, creation } = await buildLocal(o.file, o.deps);
    await mkdir(o.outDir, { recursive: true });
    const irFile = path.join(o.outDir, "context-ir.json");
    await writeFile(irFile, resolved.json);
    await writeFile(
      path.join(o.outDir, "lock.json"),
      `${JSON.stringify(resolved.lock, null, 2)}\n`,
    );
    for (const w of resolved.warnings) out.log(`warn   ${w.code}  ${w.subject}`);
    out.log(`built  ${creation.ref}  ${resolved.digest}`);
    out.log(`       ${irFile}`);
    return 0;
  } catch (e) {
    return reportError(out, e);
  }
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

export interface PreviewOptions {
  file: string;
  deps?: string[];
  tokenizer: "estimate" | "o200k_base" | "cl100k_base";
  contextWindow: number;
  mode: "narrator" | "per-agent";
  locale?: string;
  persona: string;
  messages: string[];
}

export async function cmdPreview(o: PreviewOptions, out: Output): Promise<number> {
  try {
    const { resolved } = await buildLocal(o.file, o.deps);
    const counter = await createTokenCounter(o.tokenizer);
    const session: SessionInput = {
      bindings: { user: { kind: "persona", display_name: o.persona } },
      history: o.messages.map((text) => ({ role: "user" as const, text })),
      ...(o.locale ? { locale: o.locale } : {}),
    };
    const result = assemble({
      ir: resolved.ir,
      profile: {
        runtime: { name: "char-cli", version: "0.0.0" },
        tokenizer: o.tokenizer,
        context_window: o.contextWindow,
        reserve_for_output: Math.min(1024, Math.floor(o.contextWindow / 4)),
        mode: o.mode,
        capabilities: {},
        ...(o.locale ? { locale: o.locale } : {}),
      },
      session,
      counter,
    });
    const t = result.trace;
    out.log(
      `Context Preview · ${t.total_tokens} tokens · tokenizer: ${t.profile.tokenizer}${t.estimated ? " (estimate)" : ""}`,
    );
    out.log("");
    for (const e of t.entries) {
      const tokens = e.decision === "included" ? String(e.tokens) : "—";
      out.log(`${e.decision.padEnd(9)} ${e.reason.padEnd(16)} ${tokens.padStart(6)}  ${e.id}`);
      if (e.origin && e.origin.via.length > 0)
        out.log(`${" ".repeat(34)}via: ${e.origin.via.join(" → ")}`);
      for (const ob of e.origin?.overridden_by ?? []) {
        out.log(`${" ".repeat(34)}overridden by: ${ob.creation} (${ob.op})`);
      }
    }
    return 0;
  } catch (e) {
    return reportError(out, e);
  }
}
