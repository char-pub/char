#!/usr/bin/env node
/** `char` 命令行入口：只负责解析参数，逻辑在 commands.ts。 */
import { OPEN_CREATION_TYPES } from "@char-pub/core";
import { Command, InvalidArgumentError, Option } from "commander";
import { cmdBuild, cmdCheck, cmdInit, cmdPreview, cmdTest, consoleOutput } from "./commands.js";
import { cmdLogin, cmdPublish, DEFAULT_REGISTRY } from "./remote.js";

const program = new Command()
  .name("char")
  .description("Author, check and build char.pub creations")
  .version("0.0.0");

const positiveInt = (v: string) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return n;
};
const collect = (v: string, prev: string[]) => [...prev, v];

program
  .command("init")
  .description("create a char.yaml in a directory")
  .argument("[dir]", "target directory", ".")
  .requiredOption("--ref <ref>", "public identifier, e.g. @you/alice")
  .addOption(
    new Option("--type <type>", "creation type")
      .choices([...OPEN_CREATION_TYPES])
      .default("character"),
  )
  .option("--name <name>", "display name", "Untitled")
  .action(async (dir: string, o) => {
    process.exitCode = await cmdInit(
      { dir, ref: o.ref, type: o.type, name: o.name },
      consoleOutput,
    );
  });

program
  .command("check")
  .description("validate char.yaml; --fix writes generated fragment ids back")
  .option("-f, --file <file>", "path to char.yaml", "char.yaml")
  .option("--fix", "generate missing stable fragment ids and write them back")
  .addOption(
    new Option("--source <source>", "where this creation is hosted").choices(["github", "native"]),
  )
  .action(async (o) => {
    process.exitCode = await cmdCheck(
      { file: o.file, fix: Boolean(o.fix), source: o.source },
      consoleOutput,
    );
  });

program
  .command("build")
  .description("build a creation artifact and exact dependency lock")
  .option("-f, --file <file>", "path to char.yaml", "char.yaml")
  .option("--dep <file>", "dependency release snapshot (repeatable)", collect, [])
  .option("-o, --out <dir>", "output directory", "dist")
  .action(async (o) => {
    process.exitCode = await cmdBuild({ file: o.file, deps: o.dep, outDir: o.out }, consoleOutput);
  });

program
  .command("preview")
  .description("assemble the context for a sample session and print the trace")
  .option("-f, --file <file>", "path to char.yaml", "char.yaml")
  .option("--dep <file>", "dependency release snapshot (repeatable)", collect, [])
  .addOption(
    new Option("--tokenizer <name>", "tokenizer")
      .choices(["estimate", "o200k_base", "cl100k_base"])
      .default("estimate"),
  )
  .option("--context-window <n>", "context window in tokens", positiveInt, 8192)
  .addOption(
    new Option("--mode <mode>", "runtime mode")
      .choices(["narrator", "per-agent"])
      .default("narrator"),
  )
  .option("--locale <locale>", "session locale")
  .option("--preset <file>", "explicit Preset char.yaml")
  .option("--session <file>", "Session JSON with individual slot bindings")
  .option("--persona <name>", "name of the user persona", "User")
  .option("-m, --message <text>", "chat message (repeatable)", collect, [])
  .action(async (o) => {
    process.exitCode = await cmdPreview(
      {
        file: o.file,
        deps: o.dep,
        tokenizer: o.tokenizer,
        contextWindow: o.contextWindow,
        mode: o.mode,
        persona: o.persona,
        messages: o.message,
        ...(o.preset ? { preset: o.preset } : {}),
        ...(o.session ? { session: o.session } : {}),
        ...(o.locale ? { locale: o.locale } : {}),
      },
      consoleOutput,
    );
  });

program
  .command("test")
  .description("run published deterministic assembly fixtures without calling a model")
  .option("-f, --file <file>", "path to char.yaml", "char.yaml")
  .option("--dep <file>", "dependency release snapshot (repeatable)", collect, [])
  .action(async (o) => {
    process.exitCode = await cmdTest({ file: o.file, deps: o.dep }, consoleOutput);
  });

program
  .command("login")
  .description("save a personal access token (read from stdin)")
  .option("--registry <url>", "registry API base URL", DEFAULT_REGISTRY)
  .action(async (o) => {
    // Token 从标准输入读取，避免出现在命令行参数和 shell 历史里。
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    process.exitCode = await cmdLogin(
      { registry: o.registry, token: Buffer.concat(chunks).toString("utf8") },
      consoleOutput,
    );
  });

program
  .command("publish")
  .description("check, build and publish char.yaml as a release")
  .requiredOption("--label <label>", "release label, e.g. 1.0.0")
  .option("-f, --file <file>", "path to char.yaml", "char.yaml")
  .option("--dep <file>", "dependency release snapshot (repeatable)", collect, [])
  .addOption(
    new Option("--visibility <v>", "visibility").choices(["public", "private"]).default("public"),
  )
  .action(async (o) => {
    process.exitCode = await cmdPublish(
      { file: o.file, label: o.label, visibility: o.visibility, deps: o.dep },
      consoleOutput,
    );
  });

await program.parseAsync();
