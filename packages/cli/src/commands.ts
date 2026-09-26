/**
 * `char` 命令的实现。每个命令都是一个可测试的函数，接收参数和一个输出接口，
 * 返回进程退出码；`bin.ts` 只负责解析命令行并调用它们。
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assemble,
  assembleArtifact,
  createTokenCounter,
  runAssemblyTests,
  type SessionInput,
} from "@char-pub/assembler";
import {
  buildCreation,
  CharError,
  type CheckDiagnostic,
  type CreationType,
  canonicalizeCreation,
  checkCreation,
  isCharError,
  PRESET_REGIONS,
  type ReleaseInput,
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
  type: CreationType;
  name: string;
}

function baseTemplate(o: InitOptions) {
  return {
    ref: o.ref,
    type: o.type,
    display_name: o.name,
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  };
}
function contentTemplate(o: InitOptions, kind: string) {
  return {
    ...baseTemplate(o),
    fragments: [
      { id: "main", kind, content: { type: "text", text: "Describe the setting here." } },
    ],
  };
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
  persona: (o) => contentTemplate(o, "persona"),
  style: (o) => contentTemplate(o, "style"),
  relationship: (o) => ({
    ...contentTemplate(o, "relationship"),
    slots: {
      first: { accepts: ["character", "persona"], required: false },
      second: { accepts: ["character", "persona"], required: false },
    },
  }),
  scenario: (o) => ({
    ...contentTemplate(o, "scenario"),
    cast: [{ key: "lead", who: { late: "character", hint: "Lead" }, role: "lead" }],
  }),
  preset: (o) => ({
    ...baseTemplate(o),
    policy: {
      version: "0-draft",
      blocks: [{ id: "main", text: "Write the next turn of the story.", position: "main" }],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
  }),
  "prompt-module": (o) => ({
    ...baseTemplate(o),
    prompt_module: {
      version: "0-draft",
      blocks: [{ id: "main", text: "Use concrete sensory details.", position: "main" }],
    },
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

export async function buildLocal(
  file: string,
  depFiles: readonly string[] = [],
): Promise<
  ReturnType<typeof buildCreation> & {
    project: Awaited<ReturnType<typeof loadCharYaml>>;
    creation: ReturnType<typeof canonicalizeCreation>["creation"];
    root: ReleaseInput;
    dependencies: ReleaseInput[];
  }
> {
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
  const build = buildCreation({ root, dependencies });
  return { project, creation, root, dependencies, ...build };
}

export async function cmdBuild(o: BuildOptions, out: Output): Promise<number> {
  try {
    const build = await buildLocal(o.file, o.deps);
    const { artifact, creation } = build;
    await mkdir(o.outDir, { recursive: true });
    const irFile = path.join(o.outDir, "artifact.json");
    await writeFile(irFile, build.json);
    // These are exclusively generated outputs; do not leave an old kind beside the new lock.
    for (const [kind, name] of [
      ["content", "context-ir.json"],
      ["preset", "preset.json"],
      ["prompt-module", "prompt-module.json"],
    ] as const) {
      if (artifact.kind !== kind) await rm(path.join(o.outDir, name), { force: true });
    }
    if (build.resolved)
      await writeFile(path.join(o.outDir, "context-ir.json"), build.resolved.json);
    if (artifact.kind === "preset")
      await writeFile(
        path.join(o.outDir, "preset.json"),
        `${JSON.stringify(artifact.preset, null, 2)}\n`,
      );
    if (artifact.kind === "prompt-module")
      await writeFile(
        path.join(o.outDir, "prompt-module.json"),
        `${JSON.stringify(artifact.module, null, 2)}\n`,
      );
    await writeFile(path.join(o.outDir, "lock.json"), `${JSON.stringify(build.lock, null, 2)}\n`);
    for (const w of build.warnings) out.log(`warn   ${w.code}  ${w.subject}`);
    out.log(`built  ${creation.ref}  ${build.digest}`);
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
  /** Local Preset char.yaml, with exact imported module snapshots in deps. */
  preset?: string;
  /** Public or private local Session JSON; never written into Creation. */
  session?: string;
}

export async function cmdPreview(o: PreviewOptions, out: Output): Promise<number> {
  try {
    const { artifact } = await buildLocal(o.file, o.deps);
    if (artifact.kind !== "content")
      throw new CharError({ code: "cli.content_required", subject: o.file });
    const policy = o.preset ? (await buildLocal(o.preset, o.deps)).artifact : undefined;
    if (policy && policy.kind !== "preset")
      throw new CharError({ code: "cli.preset_required", subject: o.preset ?? "preset" });
    const counter = await createTokenCounter(o.tokenizer);
    const session: SessionInput = o.session
      ? (JSON.parse(await readFile(o.session, "utf8")) as SessionInput)
      : {
          bindings: { user: { kind: "persona", display_name: o.persona } },
          history: o.messages.map((text) => ({ role: "user" as const, text })),
          ...(o.locale ? { locale: o.locale } : {}),
        };
    const result =
      artifact.assembly && !policy
        ? await assembleArtifact({ artifact, session })
        : assemble({
            ir: artifact.ir,
            ...(policy?.kind === "preset" ? { preset: policy.preset } : {}),
            profile: {
              runtime: { name: "char-cli", version: "0.0.0" },
              tokenizer: o.tokenizer,
              context_window: o.contextWindow,
              reserve_for_output: Math.min(1024, Math.floor(o.contextWindow / 4)),
              mode: o.mode,
              capabilities: { system_role: true, multiple_system_messages: true },
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
    out.log("\nMessages");
    for (const message of result.messages) out.log(`[${message.role}] ${message.content}`);
    return 0;
  } catch (e) {
    return reportError(out, e);
  }
}

export async function cmdTest(o: { file: string; deps?: string[] }, out: Output): Promise<number> {
  try {
    const build = await buildLocal(o.file, o.deps);
    const report = await runAssemblyTests({ root: build.root, dependencies: build.dependencies });
    for (const result of report.results) {
      out.log(
        `${result.ok ? "PASS" : "FAIL"} ${result.id}${result.messages_digest ? ` ${result.messages_digest}` : ""}`,
      );
      for (const issue of result.issues) out.error(`  ${issue}`);
    }
    out.log(`${report.results.length} assembly test(s)`);
    return report.ok ? 0 : 1;
  } catch (error) {
    return reportError(out, error);
  }
}
