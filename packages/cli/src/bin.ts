#!/usr/bin/env node
/** `char` 命令行入口：只负责解析参数，逻辑在 commands.ts。 */
import { Command, InvalidArgumentError, Option } from "commander";
import { cmdBuild, cmdCheck, cmdInit, cmdPreview, consoleOutput } from "./commands.js";

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
      .choices(["character", "world", "lorebook"])
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
  .description("resolve char.yaml into a Context IR")
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
        ...(o.locale ? { locale: o.locale } : {}),
      },
      consoleOutput,
    );
  });

await program.parseAsync();
