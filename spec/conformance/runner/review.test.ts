/** Acceptance preflight tests never promote files or mark repository cases reviewed. */
import { describe, expect, it, vi } from "vitest";
import { createDraftReviewReceipt, validateDraftForAcceptance } from "./review.js";
import * as runner from "./run.js";
import type { BundledCase } from "./types.js";

function fixture(): BundledCase {
  return {
    dir: "synthetic-story-review",
    meta: {
      id: "synthetic-story-review",
      title: "Independent candidate",
      kind: "story",
      expect: "story",
      spec_refs: ["Story §14.2"],
      status: "draft",
    },
    input: {
      deps: [],
      story: {
        kind: "evaluation",
        story: { version: 1, scenes: [{ id: "entry", title: "Entry" }] },
        cast: ["player"],
        operations: [],
      },
    },
    expected: {},
  };
}
function draft(c: BundledCase) {
  const result = runner.renderDraft(runner.runCase(c));
  if (!result) throw new Error("fixture must be executable");
  return result.text;
}

describe("candidate acceptance freshness", () => {
  it("allows the exact current output but never changes inputs, status or expectations", () => {
    const c = fixture();
    const before = JSON.stringify(c);
    const text = draft(c);
    expect(
      validateDraftForAcceptance(c, text, createDraftReviewReceipt(c, { file: "story", text })),
    ).toEqual([]);
    expect(JSON.stringify(c)).toBe(before);
    expect(c.meta.status).toBe("draft");
    expect(c.expected).toEqual({});
  });

  it("rejects an old candidate after inputs change and an edited candidate after execution", () => {
    const c = fixture();
    const old = draft(c);
    const receipt = createDraftReviewReceipt(c, { file: "story", text: old });
    if (c.input.story?.kind !== "evaluation") throw new Error("evaluation fixture required");
    c.input.story.story.scenes[0] = { id: "new-entry", title: "New entry" };
    expect(validateDraftForAcceptance(c, old, receipt).join(" ")).toContain("does not match");
    const fresh = draft(c);
    expect(
      validateDraftForAcceptance(
        c,
        fresh.replace('"stopped": false', '"stopped": true'),
        createDraftReviewReceipt(c, { file: "story", text: fresh }),
      ).join(" "),
    ).toContain("does not match");
    expect(c.meta.status).toBe("draft");
  });

  it("rejects invalid setup and a different declared output before any acceptance", () => {
    const c = fixture();
    const text = draft(c);
    c.meta.expect = "error";
    expect(
      validateDraftForAcceptance(
        c,
        text,
        createDraftReviewReceipt(c, { file: "error", text }),
      ).join(" "),
    ).toContain("produced story, expected error");
    c.meta.kind = "resolver";
    expect(validateDraftForAcceptance(c, text).join(" ")).toContain("Missing root");
    c.meta.kind = "story";
    delete c.input.story;
    expect(validateDraftForAcceptance(c, text).length).toBeGreaterThan(0);
  });

  it("does not let matching draft bytes bypass a hard violation", () => {
    const c = fixture();
    const actual = runner.runCase(c);
    if (actual.kind !== "story") throw new Error("story result required");
    const text = draft(c);
    const execute = vi
      .spyOn(runner, "runCase")
      .mockReturnValue({ ...actual, violations: ["input was mutated"] });
    try {
      expect(
        validateDraftForAcceptance(
          c,
          text,
          createDraftReviewReceipt(c, { file: "story", text }),
        ).join(" "),
      ).toContain("input was mutated");
    } finally {
      execute.mockRestore();
    }
    expect(c.meta.status).toBe("draft");
  });
});

it("rejects changed inputs even when they produce exactly the same observable states", () => {
  const c = fixture();
  const text = draft(c);
  const receipt = createDraftReviewReceipt(c, { file: "story", text });
  if (c.input.story?.kind !== "evaluation") throw new Error("evaluation fixture required");
  c.input.story.story.scenes[0] = { id: "entry", title: "A changed premise" };
  expect(draft(c)).toBe(text);
  expect(validateDraftForAcceptance(c, text, receipt).join(" ")).toContain("does not match");
});

it("binds exact author strings and review metadata, and requires regeneration of legacy candidates", () => {
  const c = fixture();
  const text = draft(c);
  const receipt = createDraftReviewReceipt(c, { file: "story", text });
  expect(validateDraftForAcceptance(c, text).join(" ")).toContain(
    "Missing or invalid review receipt",
  );
  c.meta.notes = "Review the new condition semantics.\r\ne\u0301 ";
  expect(createDraftReviewReceipt(c, { file: "story", text }).input_digest).not.toBe(
    receipt.input_digest,
  );
  const changed = createDraftReviewReceipt(c, { file: "story", text });
  c.meta.notes = c.meta.notes.normalize("NFC").replaceAll("\r\n", "\n");
  expect(createDraftReviewReceipt(c, { file: "story", text }).input_digest).not.toBe(
    changed.input_digest,
  );
});

it("re-executes the implementation even when the candidate and receipt agree with each other", () => {
  const c = fixture();
  const altered = draft(c).replace('"stopped": false', '"stopped": true');
  const receipt = createDraftReviewReceipt(c, { file: "story", text: altered });
  expect(validateDraftForAcceptance(c, altered, receipt).join(" ")).toContain("stale or edited");
});
