/**
 * `pnpm conformance:draft [<case> ...]`：运行当前实现，把输出写到 cases/<case>/draft/，
 * 供人工审阅。不带参数时处理全部用例。
 *
 * draft/ 不提交到仓库。审阅人逐项核对输出是否符合规范后，再用 `conformance:accept`
 * 把它变成预期结果；不能跳过审阅直接把当前输出当作规范。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDraft, runCase } from "../runner/run.js";
import { EXPECTED_FILES } from "../runner/types.js";
import { CASES_DIR, listCaseDirs, loadCase } from "./cases.js";

const args = process.argv.slice(2);
const dirs = args.length > 0 ? args : listCaseDirs();

for (const dir of dirs) {
  const c = loadCase(dir);
  const actual = runCase(c);
  const draft = renderDraft(actual);
  if (!draft) {
    console.log(`${dir}: skipped (${actual.kind === "unsupported" ? actual.reason : actual.kind})`);
    continue;
  }
  if (c.meta.expect && c.meta.expect !== draft.file) {
    console.warn(
      `${dir}: case expects ${c.meta.expect} but the implementation produced ${draft.file}`,
    );
  }
  const out = join(CASES_DIR, dir, "draft");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, EXPECTED_FILES[draft.file]), draft.text);
  const summary =
    actual.kind === "context-ir"
      ? actual.digest
      : actual.kind === "error"
        ? `${actual.error.code} (${actual.error.subject ?? ""})${actual.detail ? `: ${actual.detail}` : ""}`
        : actual.kind === "publish"
          ? JSON.stringify(actual.summary)
          : actual.kind === "trace"
            ? actual.trace.scenarios
                .map((sc) =>
                  "error" in sc
                    ? `${sc.name}: ${sc.error.code}`
                    : `${sc.name}: ${sc.entries.length} entries`,
                )
                .join("; ") +
              (actual.violations.length ? `  VIOLATIONS: ${actual.violations.join("; ")}` : "")
            : actual.kind === "loss-report"
              ? `policy fields ${actual.summary.import.omitted_policy_fields.join(", ")}; unstable ${actual.summary.import.unstable_fragments.join(", ")}`
              : "";
  console.log(`${dir}: draft/${EXPECTED_FILES[draft.file]}  ${summary}`);
}
