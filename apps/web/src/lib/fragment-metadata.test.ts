import { expect, it } from "vitest";
import { sourceError, speakerError, speakerOptions } from "./fragment-metadata";

it("uses declared slot and cast identities without inventing self for a Scenario", () => {
  const w = {
    type: "scenario",
    cast: [{ key: "guard", who: { late: "character" } }],
    slots: { rival: { accepts: "character" } },
  };
  expect(speakerOptions(w).map((option) => option.value)).toEqual([
    "{{user}}",
    "{{slot:rival}}",
    "{{cast:guard}}",
  ]);
  expect(speakerError(w, "{{self}}")).toContain("Missing speaker");
  expect(speakerError(w, "{{cast:absent}}")).toContain("Missing speaker");
  expect(speakerError(w, "@indirect/actor")).toBeNull();
  expect(speakerError(w, "https://example.org")).toContain("reference");
});

it("validates Source syntax through Core segment rules and keeps external closure resolution for build", () => {
  expect(sourceError({}, "@archive/book#manual/chapter")).toBeNull();
  expect(sourceError({}, "@archive/book#manual/chapter#")).not.toBeNull();
  expect(sourceError({}, "@archive/book#manual/section/extra")).not.toBeNull();
  expect(sourceError({}, "https://example.org/document")).not.toBeNull();
  expect(sourceError({}, "#missing")).toContain("Missing source");
});

it("does not advertise local reference edges as speaker identities", () => {
  expect(
    speakerOptions({ references: [{ id: "local", use: "#local", mode: "default" }] }).map(
      (option) => option.value,
    ),
  ).toEqual(["{{user}}"]);
});
