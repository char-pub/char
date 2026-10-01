import { describe, expect, it } from "vitest";
import { RuntimeLaunchRequestSchema, RuntimeRegistryOriginSchema } from "../src/runtime-launch.js";

const request = {
  format: "char.pub/runtime-launch",
  version: 1,
  registry_origin: "https://api.char.pub",
  source: {
    ref: "@writer/story",
    release: "rel_01j00000000000000000000000",
    semantic_digest: `sha256:${"1".repeat(64)}`,
  },
  lock_digest: `sha256:${"2".repeat(64)}`,
  locale: "zh-CN",
  start: "arrival",
  view: { mode: "per-agent", for_participant: "alice" },
};
describe("Runtime launch transport", () => {
  it("preserves an exact published target and the requested opening and participant", () => {
    expect(RuntimeLaunchRequestSchema.parse(request)).toEqual(request);
  });
  it("preserves a draft revision and expiry without turning the request into authorization", () => {
    const draft = {
      ...request,
      source: {
        ref: request.source.ref,
        semantic_digest: request.source.semantic_digest,
        origin: {
          kind: "draft-build",
          build_id: "dbld_01j00000000000000000000000",
          revision: "rev_01j00000000000000000000000",
          expires_at: "2026-10-08T00:00:00.000Z",
        },
      },
      view: { mode: "narrator" },
    };
    expect(RuntimeLaunchRequestSchema.parse(draft)).toEqual(draft);
    for (const field of [
      "token",
      "approved",
      "history",
      "bindings",
      "provider",
      "artifact",
      "callback",
      "redirect_uri",
    ])
      expect(RuntimeLaunchRequestSchema.safeParse({ ...draft, [field]: "UNTRUSTED" }).success).toBe(
        false,
      );
    expect(
      RuntimeLaunchRequestSchema.safeParse({
        ...draft,
        source: {
          ...draft.source,
          origin: { kind: "local-build", input_digest: request.lock_digest },
        },
      }).success,
    ).toBe(false);
    expect(
      RuntimeLaunchRequestSchema.safeParse({
        ...draft,
        source: { ...draft.source, release: request.source.release },
      }).success,
    ).toBe(false);
  });
  it("requires a speaker for a participant view and rejects session state hidden in nested fields", () => {
    expect(
      RuntimeLaunchRequestSchema.safeParse({ ...request, view: { mode: "per-agent" } }).success,
    ).toBe(false);
    expect(
      RuntimeLaunchRequestSchema.safeParse({ ...request, view: { ...request.view, history: [] } })
        .success,
    ).toBe(false);
    expect(
      RuntimeLaunchRequestSchema.safeParse({
        ...request,
        source: { ...request.source, token: "SECRET" },
      }).success,
    ).toBe(false);
  });
  it("accepts secure or loopback origins but rejects credentials, query strings, paths and remote plaintext", () => {
    for (const origin of [
      "https://api.char.pub",
      "http://127.0.0.1:8787",
      "http://localhost:3000",
      "http://[::1]:8787",
    ])
      expect(RuntimeRegistryOriginSchema.safeParse(origin).success).toBe(true);
    for (const origin of [
      "http://api.char.pub",
      "https://user:pass@api.char.pub",
      "https://api.char.pub/",
      "https://api.char.pub/v1",
      "https://api.char.pub?token=x",
      "https://api.char.pub#secret",
      "file:///tmp/runtime",
      "not a URL",
      "https://api.char.pub.evil/launch",
    ])
      expect(RuntimeRegistryOriginSchema.safeParse(origin).success).toBe(false);
  });
});
