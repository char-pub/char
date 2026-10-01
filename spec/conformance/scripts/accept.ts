/**
 * `pnpm conformance:accept <case> --reviewer <name> [--date YYYY-MM-DD]`
 *
 * 审阅人确认 draft/ 中的输出符合规范之后运行：把 draft 移到 expected/，
 * 在 case.json 中把 status 改为 reviewed，并记录审阅人、日期和预期 digest，
 * 然后重新生成 bundle。只接受与 case.json 中 `expect` 形态一致的 draft。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { validateDraftForAcceptance } from "../runner/review.js";
import { normalizeExpectedText, textDigest } from "../runner/run.js";
import { type CaseMeta, EXPECTED_FILES } from "../runner/types.js";
import { BUNDLE_PATH, buildBundle, caseDirectory, loadCase, serializeBundle } from "./cases.js";

function usage(msg: string): never {
  console.error(
    `${msg}\nusage: pnpm conformance:accept <case> --reviewer <name> [--date YYYY-MM-DD]`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const dir = args[0];
if (!dir || dir.startsWith("--")) usage("missing case directory");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const reviewer = flag("--reviewer");
if (!reviewer) usage("missing --reviewer");
const date = flag("--date") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) usage("--date must be YYYY-MM-DD");

const base = caseDirectory(dir);
const metaPath = join(base, "case.json");
if (!existsSync(metaPath)) usage(`no such case: ${dir}`);
const meta = JSON.parse(readFileSync(metaPath, "utf8")) as CaseMeta;
if (!meta.expect || !Object.hasOwn(EXPECTED_FILES, meta.expect))
  usage(`${dir}: case.json has no "expect" kind; this case cannot be accepted yet`);

const draftDir = join(base, "draft");
const file = EXPECTED_FILES[meta.expect];
const draftFile = join(draftDir, file);
if (!existsSync(draftFile)) {
  const found = existsSync(draftDir) ? readdirSync(draftDir).join(", ") : "nothing";
  usage(`${dir}: expected draft/${file}, found ${found}. Run conformance:draft first.`);
}

const receiptPath = join(draftDir, "review.json");
const receipt: unknown = existsSync(receiptPath)
  ? JSON.parse(readFileSync(receiptPath, "utf8"))
  : undefined;
// Persist the same text that passed review, even if the draft path is replaced later.
const draftText = readFileSync(draftFile, "utf8");
const problems = validateDraftForAcceptance(loadCase(dir), draftText, receipt);
if (problems.length) usage(`${dir}: cannot accept stale or invalid draft: ${problems.join("; ")}`);

const expDir = join(base, "expected");
rmSync(expDir, { recursive: true, force: true });
mkdirSync(expDir, { recursive: true });
writeFileSync(join(expDir, file), draftText, { flag: "wx" });
rmSync(draftDir, { recursive: true, force: true });

const next: CaseMeta = { ...meta, status: "reviewed", reviewed_by: reviewer, reviewed_at: date };
if (meta.expect === "context-ir") {
  next.expected_digest = textDigest(normalizeExpectedText(draftText));
} else {
  delete next.expected_digest;
}
// Publish metadata by replacing the directory entry, never by following a path that
// could have been swapped for a symlink after it was read during review.
const metadataStage = mkdtempSync(join(base, ".accept-"));
try {
  const stagedMeta = join(metadataStage, "case.json");
  writeFileSync(stagedMeta, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  renameSync(stagedMeta, metaPath);
} finally {
  rmSync(metadataStage, { recursive: true, force: true });
}
writeFileSync(BUNDLE_PATH, serializeBundle(buildBundle()));
console.log(`${dir}: accepted by ${reviewer} on ${date}; bundle regenerated`);
