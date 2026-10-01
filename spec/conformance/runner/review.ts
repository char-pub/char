/** Read-only acceptance preflight: human review cannot promote a stale or invalid candidate. */
import { type JSONValue, jcs } from "@char-pub/core";
import {
  judge,
  normalizeExpectedText,
  renderDraft,
  runCase,
  textDigest,
  validateInput,
} from "./run.js";
import { type BundledCase, EXPECTED_FILES } from "./types.js";

export interface DraftReviewReceipt {
  format: 1;
  input_digest: string;
  file: string;
  output_digest: string;
}

function inputDigest(c: BundledCase): string {
  const { id, title, kind, expect, spec_refs, notes } = c.meta;
  // JSON erases absent optional properties; JCS orders keys without normalizing authored strings.
  const value = JSON.parse(
    JSON.stringify({
      domain: "char.pub/conformance-review/v1",
      dir: c.dir,
      meta: { id, title, kind, expect, spec_refs, notes },
      input: c.input,
    }),
  ) as JSONValue;
  return textDigest(jcs(value));
}

/** Bind a generated candidate to its exact authored inputs and comparable output bytes. */
export function createDraftReviewReceipt(
  c: BundledCase,
  rendered: { file: string; text: string },
): DraftReviewReceipt {
  return {
    format: 1,
    input_digest: inputDigest(c),
    file: rendered.file,
    output_digest: textDigest(normalizeExpectedText(rendered.text)),
  };
}

/** Re-execute current inputs before any expected files or review metadata may be changed. */
export function validateDraftForAcceptance(
  c: BundledCase,
  draftText: string,
  receipt?: unknown,
): string[] {
  if (!["resolver", "assembler", "publish", "ccv3", "story"].includes(c.meta.kind))
    return ["Unknown case kind; cannot accept this candidate."];
  if (!c.meta.expect || !Object.hasOwn(EXPECTED_FILES, c.meta.expect))
    return ["Missing or unknown expected output kind."];
  if (c.meta.kind !== "ccv3" && c.meta.kind !== "story" && !c.input.root)
    return ["Missing root input; fixture setup errors cannot become accepted expectations."];
  try {
    if (
      !receipt ||
      typeof receipt !== "object" ||
      !("format" in receipt) ||
      receipt.format !== 1 ||
      !("input_digest" in receipt) ||
      !("file" in receipt) ||
      !("output_digest" in receipt)
    )
      return [
        "Missing or invalid review receipt. Regenerate and review this draft before accepting.",
      ];
    if (
      receipt.input_digest !== inputDigest(c) ||
      receipt.file !== c.meta.expect ||
      receipt.output_digest !== textDigest(normalizeExpectedText(draftText))
    )
      return [
        "Candidate receipt does not match current inputs or output. Regenerate and review this draft before accepting.",
      ];
    const invalid = validateInput(c);
    if (invalid.length) return invalid.map((problem) => `Invalid fixture input: ${problem}`);
    const actual = runCase(c);
    const verdict = judge({ ...c, meta: { ...c.meta, status: "draft" } }, actual);
    if (verdict.status !== "draft")
      return [`Candidate violates a fixture requirement: ${verdict.message ?? actual.kind}`];
    const rendered = renderDraft(actual);
    if (!rendered || rendered.file !== c.meta.expect)
      return [`Current implementation produced ${actual.kind}, expected ${c.meta.expect}.`];
    if (normalizeExpectedText(rendered.text) !== normalizeExpectedText(draftText))
      return [
        "Candidate is stale or edited. Regenerate its draft and review the new output before accepting.",
      ];
    return [];
  } catch (error) {
    return [
      `Cannot execute fixture: ${error instanceof Error ? error.message : "unknown failure"}`,
    ];
  }
}
