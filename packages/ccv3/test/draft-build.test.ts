import { buildCreation } from "@char-pub/core";
import { expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { DRAFT_ORIGIN, draftInput } from "../../core/test/draft-build-fixtures.js";
import { exportCCv3 } from "../src/export.js";

it("retains draft provenance in card extensions without claiming a Release", () => {
  const { artifact } = buildTestCreation(draftInput());
  const policy = buildCreation(draftInput("preset")).artifact;
  if (artifact.kind !== "content" || policy.kind !== "preset") throw new Error("Wrong fixture");
  const { card } = exportCCv3(artifact, { resolvedPreset: policy.preset });
  const extension = card.data.extensions.char_pub;
  expect(extension).toMatchObject({
    root: { origin: DRAFT_ORIGIN },
    preset: { origin: DRAFT_ORIGIN },
  });
  expect(extension).not.toHaveProperty("root.release");
  expect(extension).not.toHaveProperty("preset.release");
  expect(card.data.system_prompt).toContain("DRAFT_POLICY");
});
