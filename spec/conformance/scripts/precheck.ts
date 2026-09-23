/**
 * `pnpm conformance:precheck [<case>...]`：对 draft 中的 Context IR 运行机器预检。
 * 检查项见 precheck-lib.ts。通过预检不代表可以跳过人工审阅。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CASES_DIR } from "./cases.js";
import { precheck } from "./precheck-lib.js";

const wanted = process.argv.slice(2);
let failed = 0;
for (const dir of readdirSync(CASES_DIR).sort()) {
  if (wanted.length > 0 && !wanted.includes(dir)) continue;
  let text: string;
  try {
    text = readFileSync(join(CASES_DIR, dir, "draft", "context-ir.json"), "utf8");
  } catch {
    continue;
  }
  const issues = precheck(text);
  if (issues.length === 0) console.log(`ok    ${dir}`);
  else {
    failed++;
    console.log(`FAIL  ${dir}`);
    for (const i of issues) console.log(`      ${i}`);
  }
}
if (failed > 0) process.exit(1);
