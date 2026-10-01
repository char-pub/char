import { prepareContext } from "@char-pub/assembler";
import { expect, it } from "vitest";
import { buildTestCreation } from "@/test/build";
import {
  DEFAULT_SETTINGS,
  previewFragmentChoices,
  previewInput,
  selectPreviewInput,
} from "./preview";

const result = buildTestCreation({
  root: {
    release: "rel_01j00000000000000000000000",
    visibility: "public",
    creation: {
      id: "cr_01j00000000000000000000000",
      ref: "@writer/library",
      type: "world",
      display_name: "Library",
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
      fragments: [
        { id: "world", stable: true, kind: "world", content: { type: "text", text: "An inn." } },
        {
          id: "rumor",
          stable: true,
          kind: "knowledge",
          description: "When investigating the door",
          activation: { mode: "keyword", keys: ["absenttrigger"] },
          selectable: true,
          perspective: "rumor",
          content: { type: "text", text: "Secret payload about the door." },
        },
        {
          id: "manual",
          stable: true,
          kind: "knowledge",
          activation: { mode: "manual" },
          content: { type: "text", text: "Manual payload" },
        },
        {
          id: "keyword",
          stable: true,
          kind: "knowledge",
          activation: { mode: "keyword", keys: ["absenttrigger"] },
          content: { type: "text", text: "Keyword only payload" },
        },
      ],
    },
  },
});
it("offers description-only eligible candidates and feeds fixed selection into actual messages", () => {
  if (result.artifact.kind !== "content") throw new Error("content expected");
  const input = previewInput(result.artifact, DEFAULT_SETTINGS);
  const choices = previewFragmentChoices(input);
  expect(choices.map((c) => c.ref.fragment)).toEqual(["@writer/library#rumor~root"]);
  expect(JSON.stringify(choices)).not.toContain("Secret payload");
  expect(JSON.stringify(prepareContext(input).messages)).not.toContain("Secret payload");
  const selected = selectPreviewInput(
    input,
    choices.map((c) => c.ref),
  );
  expect(JSON.stringify(prepareContext(selected).messages)).toContain("Secret payload");
  expect(JSON.stringify(prepareContext(selected).messages)).toContain("传闻");
  expect(input).not.toHaveProperty("plan");
});
