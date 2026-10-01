import { sha256Bytes } from "@char-pub/core";
import { expect, it } from "vitest";
import { assistanceWorking, assistanceBody as body, candidate } from "@/test/author-assistance";
import {
  type AssistanceSelection,
  applyAssistanceReview,
  createAssistanceRequest,
  reviewAssistanceCandidate,
  undoAssistanceReview,
} from "./author-assistance";

function request(
  selection: Omit<AssistanceSelection, "instructions" | "context">,
  working = assistanceWorking,
) {
  return createAssistanceRequest(
    working,
    {
      ...selection,
      instructions: "Draft the selected content.",
      context: "Only author-selected context.",
    },
    selection.kind === "sections" ? body : undefined,
  );
}
it.each([
  {
    kind: "description",
    target: { kind: "beat", id: "unfinished" },
    output: { description: "The traveler decides to stay." },
  },
  {
    kind: "sections",
    target: { kind: "source", id: "guide" },
    output: {
      sections: [
        { id: "harbor", title: "Harbor", anchor: "#Harbor", description: "Where ships arrive." },
      ],
    },
  },
  {
    kind: "condition",
    target: { kind: "scene", id: "harbor" },
    output: { condition: { cmp: ["var/trust", ">=", 2] } },
  },
  {
    kind: "perspective",
    target: { kind: "fragment", id: "mira" },
    output: { outward_text: "Mira wears a blue coat.", inner_text: "Mira fears deep water." },
  },
  {
    kind: "play",
    target: { kind: "scene", id: "next" },
    output: { object: { id: "next", title: "Next", opening: "A bell rings." } },
  },
  {
    kind: "play",
    target: { kind: "beat", id: "promise" },
    scene: "harbor",
    output: { object: { id: "promise", title: "Promise", description: "They agree to meet." } },
  },
  {
    kind: "play",
    target: { kind: "ending", id: "return" },
    output: {
      object: {
        id: "return",
        title: "Return",
        description: "They return safely.",
        when: { in: "scene/harbor" },
      },
    },
  },
] as const)(
  "reviews and applies $kind/$target.kind without requiring a canonical incomplete draft",
  (item) => {
    const before = structuredClone(assistanceWorking);
    const req = request(item);
    const review = reviewAssistanceCandidate(before, req, candidate(req, item.output));
    expect(before).toEqual(assistanceWorking);
    expect(req.input).not.toHaveProperty("assets");
    expect(req.input).not.toHaveProperty("story");
    const after = applyAssistanceReview(before, review);
    expect(after.provenance).toMatchObject({ authored_by_agent: true });
    expect(review.differences.length).toBeGreaterThan(0);
    if (item.kind !== "description") expect(review.diagnostics.join(" ")).toContain("Unfinished");
    if (item.kind === "play" && item.target.kind === "beat")
      expect((after.story as { scenes: unknown[] }).scenes).toContainEqual(
        expect.objectContaining({ id: "harbor", beats: ["promise"] }),
      );
    const undone = undoAssistanceReview({ ...after, summary: "A later unrelated edit" }, review);
    expect(undone.summary).toBe("A later unrelated edit");
    expect(undone.provenance).toMatchObject({ authored_by_agent: true });
  },
);
it("keeps original translations and fields, and does not expose their private text in the new outward fragment", () => {
  const req = request({
    kind: "perspective",
    target: { kind: "fragment", id: "mira" },
    outward_id: "appearance",
  });
  const review = reviewAssistanceCandidate(
    assistanceWorking,
    req,
    candidate(req, { outward_text: "A blue coat.", inner_text: "A private fear." }),
  );
  expect(review.after.fragments?.[0]).toMatchObject({
    id: "mira",
    description: "A private account",
    locale: assistanceWorking.fragments?.[0]?.locale,
    outward: false,
  });
  expect(review.after.fragments?.[1]).toMatchObject({ id: "appearance", outward: true });
  expect(review.after.fragments?.[1]).not.toHaveProperty("locale");
  expect(review.after.fragments?.[1]).not.toHaveProperty("description");
  expect(() =>
    request({ kind: "perspective", target: { kind: "fragment", id: "mira" }, outward_id: "mira" }),
  ).toThrow(/already exists/);
});
it.each([
  { object: { id: "next", title: "Next", lore: ["#missing"] } },
  {
    object: {
      id: "next",
      title: "Next",
      when: { knows: { who: "player", info: "#missing" } },
    },
  },
  { object: { id: "next", title: "Next", opening: "{{cast:missing}} enters." } },
])("rejects new references despite another unfinished object: %j", (output) => {
  const req = request({ kind: "play", target: { kind: "scene", id: "next" } });
  expect(() => reviewAssistanceCandidate(assistanceWorking, req, candidate(req, output))).toThrow();
});
it("does not treat changed diagnostic suggestions for an existing bad reference as a new error", () => {
  const w = structuredClone(assistanceWorking);
  (w.story as { scenes: unknown[] }).scenes = [
    { id: "harbor", title: "Harbor", when: { in: "scene/absent" } },
  ];
  const req = request({ kind: "play", target: { kind: "scene", id: "next" } }, w);
  expect(() =>
    reviewAssistanceCandidate(w, req, candidate(req, { object: { id: "next", title: "Next" } })),
  ).not.toThrow();
});
it("rejects forged approval, stale exact text and files for another uploaded document", () => {
  const req = request({ kind: "description", target: { kind: "beat", id: "unfinished" } });
  const raw = JSON.parse(candidate(req, { description: "A bell rings." }));
  expect(() =>
    reviewAssistanceCandidate(assistanceWorking, req, JSON.stringify({ ...raw, approved: true })),
  ).toThrow();
  expect(() =>
    reviewAssistanceCandidate(
      { ...assistanceWorking, summary: "changed\r\n" },
      req,
      JSON.stringify(raw),
    ),
  ).toThrow(/draft changed/);
  expect(() =>
    createAssistanceRequest(
      assistanceWorking,
      {
        kind: "sections",
        target: { kind: "source", id: "guide" },
        instructions: "Summarize",
        context: "",
      },
      new TextEncoder().encode("Other document"),
    ),
  ).toThrow(/does not match/);
});
it("refuses Undo after target edits or after another scene references the new beat", () => {
  const req = request({ kind: "play", target: { kind: "beat", id: "promise" }, scene: "harbor" });
  const review = reviewAssistanceCandidate(
    assistanceWorking,
    req,
    candidate(req, { object: { id: "promise", title: "Promise", description: "They agree." } }),
  );
  const after = applyAssistanceReview(assistanceWorking, review);
  const changed = structuredClone(after);
  const changedBeat = (changed.story as { beats: { id: string; title: string }[] }).beats[1];
  if (!changedBeat) throw new Error("Added beat missing");
  changedBeat.title = "Edited again";
  expect(() => undoAssistanceReview(changed, review)).toThrow(/edited again/);
  const referenced = structuredClone(after);
  (referenced.story as { scenes: unknown[] }).scenes.push({
    id: "later",
    title: "Later",
    beats: ["promise"],
  });
  expect(() => undoAssistanceReview(referenced, review)).toThrow(/references/);
});
it("validates selected group and section descriptions independently of an unfinished Beat", () => {
  const w = { ...assistanceWorking, groups: [{ id: "g", title: "Group", description: "Old" }] };
  const group = request({ kind: "description", target: { kind: "group", id: "g" } }, w);
  expect(() =>
    reviewAssistanceCandidate(w, group, candidate(group, { description: "x".repeat(201) })),
  ).toThrow(/1–200/);
  const sections = request({ kind: "sections", target: { kind: "source", id: "guide" } });
  expect(() =>
    reviewAssistanceCandidate(
      assistanceWorking,
      sections,
      candidate(sections, {
        sections: [
          { id: "harbor", title: "Harbor", anchor: "#Harbor", description: "x".repeat(201) },
        ],
      }),
    ),
  ).toThrow(/1–200/);
});
it("keeps restricted outward scope unless the author explicitly requests sharing", () => {
  const w = structuredClone(assistanceWorking);
  if (!w.fragments?.[0]) throw new Error("fixture");
  w.fragments[0].visibility = { scope: "story-scene", scene: "harbor" };
  for (const outward_scope of ["preserve", "shared"] as const) {
    const req = request(
      { kind: "perspective", target: { kind: "fragment", id: "mira" }, outward_scope },
      w,
    );
    const review = reviewAssistanceCandidate(
      w,
      req,
      candidate(req, { outward_text: "Blue coat.", inner_text: "Private fear." }),
    );
    expect(review.after.fragments?.[1]?.visibility).toEqual(
      outward_scope === "shared" ? { scope: "shared" } : { scope: "story-scene", scene: "harbor" },
    );
  }
});
it("fills an already referenced but undefined Beat without duplicating or reordering its scene link", () => {
  const w = structuredClone(assistanceWorking);
  (w.story as { scenes: unknown[] }).scenes = [
    { id: "harbor", title: "Harbor", beats: ["promise"] },
  ];
  const req = request(
    { kind: "play", target: { kind: "beat", id: "promise" }, scene: "harbor" },
    w,
  );
  const review = reviewAssistanceCandidate(
    w,
    req,
    candidate(req, { object: { id: "promise", title: "Promise", description: "They agree." } }),
  );
  const after = applyAssistanceReview(w, review);
  expect((after.story as { scenes: unknown[] }).scenes).toEqual(
    (w.story as { scenes: unknown[] }).scenes,
  );
  expect(review.patches.filter((patch) => patch.field === "beats")).toEqual([]);
  const undone = undoAssistanceReview(after, review);
  expect((undone.story as { scenes: unknown[] }).scenes).toEqual(
    (w.story as { scenes: unknown[] }).scenes,
  );
});
it("refuses Undo that turns a later corrected ending reference into a new missing target at the same diagnostic path", () => {
  const w = structuredClone(assistanceWorking);
  (w.story as Record<string, unknown>).choices = [
    { id: "go", label: "Go", intent: "Go", when: { ended: "ending/previous-missing" } },
  ];
  const req = request({ kind: "play", target: { kind: "ending", id: "exit" } }, w);
  const review = reviewAssistanceCandidate(
    w,
    req,
    candidate(req, { object: { id: "exit", title: "Exit", description: "Leave." } }),
  );
  const after = applyAssistanceReview(w, review);
  (after.story as Record<string, unknown>).choices = [
    { id: "go", label: "Go", intent: "Go", when: { ended: "ending/exit" } },
  ];
  expect(() => undoAssistanceReview(after, review)).toThrow(/later references/);
});
it("refuses removing a new outward passage that later repaired an earlier missing lore reference", () => {
  const w = structuredClone(assistanceWorking);
  (w.story as Record<string, unknown>).scenes = [
    { id: "harbor", title: "Harbor", lore: ["#previous-missing"] },
  ];
  const req = request(
    { kind: "perspective", target: { kind: "fragment", id: "mira" }, outward_id: "outward" },
    w,
  );
  const review = reviewAssistanceCandidate(
    w,
    req,
    candidate(req, { outward_text: "Blue coat.", inner_text: "Private fear." }),
  );
  const after = applyAssistanceReview(w, review);
  (after.story as Record<string, unknown>).scenes = [
    { id: "harbor", title: "Harbor", lore: ["#outward"] },
  ];
  expect(() => undoAssistanceReview(after, review)).toThrow(/later references/);
});
it("accepts a complete matching document larger than the candidate JSON budget without truncation", () => {
  const text = `# Harbor\n${"x".repeat(1024 * 1024)}`;
  const bytes = new TextEncoder().encode(text);
  const w = structuredClone(assistanceWorking);
  if (!w.assets?.[0]?.variants[0]) throw new Error("fixture");
  w.assets[0].variants[0].blob = {
    availability: "mirrored",
    digest: sha256Bytes(bytes),
    size: bytes.length,
  };
  const req = createAssistanceRequest(
    w,
    {
      kind: "sections",
      target: { kind: "source", id: "guide" },
      instructions: "Describe sections.",
      context: "",
    },
    bytes,
  );
  expect(req.input.source_text).toBe(text);
  expect(new TextEncoder().encode(JSON.stringify(req)).length).toBeGreaterThan(1024 * 1024);
});
