import { RuntimeLaunchRequestSchema } from "@char-pub/contracts";
import { expect, it } from "vitest";
import { buildTestCreation } from "@/test/build";
import { draftOrigin } from "@/test/draft-build";
import { runtimeLaunchDestination, runtimeLaunchRequest, runtimeLaunchUrl } from "./runtime-launch";

function artifact() {
  const { artifact } = buildTestCreation({
    root: {
      origin: draftOrigin,
      visibility: "private",
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/story",
        type: "scenario",
        display_name: "Story",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
        cast: [{ key: "alice", who: { late: "character" } }],
        fragments: [
          {
            id: "secret",
            stable: true,
            kind: "scenario",
            content: { type: "text", text: "PRIVATE_BODY" },
          },
        ],
        story: {
          version: 1,
          scenes: [{ id: "hall", title: "Hall" }],
          starts: [
            { id: "day", title: "Day", description: "Daylight", scene: "hall" },
            { id: "night", title: "Night", description: "Darkness", scene: "hall" },
          ],
        },
      },
    },
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  return artifact;
}
it("opens the exact built revision, opening and view without transmitting private bodies", () => {
  const input = artifact();
  const speaker = input.ir.participants.find((entry) => entry.cast_key === "alice");
  if (!speaker) throw new Error("Expected Alice instance");
  const request = runtimeLaunchRequest(input, {
    registryOrigin: "http://127.0.0.1:8787",
    locale: "en",
    start: "night",
    view: { mode: "per-agent", for_participant: speaker.key },
  });
  expect(request.source).toEqual(input.root);
  expect(request.lock_digest).toBe(input.lock_digest);
  const url = new URL(runtimeLaunchUrl("http://localhost:4878/play", request));
  expect(url.pathname).toBe("/play");
  expect(url.search).toBe("");
  expect(
    RuntimeLaunchRequestSchema.parse(
      JSON.parse(decodeURIComponent(url.hash.slice("#launch=".length))),
    ),
  ).toEqual(request);
  expect(url.href).not.toContain("PRIVATE_BODY");
  expect(request).not.toHaveProperty("artifact");
});
it("requires an actual opening and participant and refuses an expired build", () => {
  const input = artifact();
  const options = {
    registryOrigin: "https://api.char.pub",
    locale: "en",
    view: { mode: "narrator" as const },
  };
  expect(() => runtimeLaunchRequest(input, options)).toThrow("Choose an opening");
  expect(() => runtimeLaunchRequest(input, { ...options, start: "missing" })).toThrow("not part");
  expect(() =>
    runtimeLaunchRequest(input, {
      ...options,
      start: "day",
      view: { mode: "per-agent", for_participant: "missing" },
    }),
  ).toThrow("Choose a participant");
  expect(() =>
    runtimeLaunchRequest(input, { ...options, start: "day" }, Date.parse(draftOrigin.expires_at)),
  ).toThrow("expired");
});
it("rejects credential-bearing or unsafe destinations instead of converting them into launch targets", () => {
  expect(runtimeLaunchDestination("https://runtime.example/play")).toBe(
    "https://runtime.example/play",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///tmp/runtime",
    "http://remote.example/play",
    "https://user:secret@runtime.example/play",
    "https://runtime.example/play?token=secret",
    "https://runtime.example/play#secret",
    "/play",
  ])
    expect(() => runtimeLaunchDestination(value)).toThrow();
});
