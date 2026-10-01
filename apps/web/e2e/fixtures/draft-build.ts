/** Stateful browser fixture: save a version, build it with the real SDK, then poll the receipt. */
import { runAssemblyTests } from "@char-pub/assembler";
import type { DraftBuildResponse } from "@char-pub/contracts";
import {
  type BuildCreationInput,
  buildCreation,
  canonicalizeCreation,
  checkCreation,
  type ExactRef,
  isCharError,
  type ReleaseInput,
  sha256Bytes,
} from "@char-pub/core";
import { type MockApi, problem } from "../mock-api";

export function draftBuildFixture(
  api: MockApi,
  initial: Record<string, unknown>,
  input: { dependencies: readonly ReleaseInput[]; defaultPolicy: ExactRef },
) {
  const base = `/v1/creations/${String(initial.ref)}`;
  let working: unknown = structuredClone(initial);
  let version = 1;
  let sequence = 0;
  const matchesVersion = (header: string | undefined) => {
    const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header?.trim() ?? "");
    return match?.[1] !== undefined && Number(match[1]) === version;
  };
  const records = new Map<
    string,
    {
      pending: DraftBuildResponse;
      completed: DraftBuildResponse;
      artifact?: unknown;
      polled: boolean;
    }
  >();
  const byDigest = new Map<string, string>();
  const headers = { "cache-control": "private, no-store" };
  api.on(`GET ${base}/draft`, () => ({
    headers,
    body: { version, working, base_revision_id: null, updated_at: "2026-10-01T00:00:00Z" },
  }));
  api.on(`PUT ${base}/draft`, (request) => {
    if (!matchesVersion(request.headers()["if-match"]))
      return problem(409, "draft.version_conflict");
    const body = request.postDataJSON() as { working: Record<string, unknown> };
    try {
      const next = { ...body.working, id: initial.id, ref: initial.ref, type: initial.type };
      const canonical = canonicalizeCreation(next);
      const checked = checkCreation(canonical.creation);
      if (!checked.ok)
        return {
          ...problem(422, "check.failed"),
          body: { code: "check.failed", diagnostics: checked.diagnostics },
        };
      working = next;
      version++;
      return {
        headers,
        body: {
          version,
          semantic_digest: canonical.semantic_digest,
          warnings: checked.diagnostics.filter((item) => item.severity !== "info"),
        },
      };
    } catch (error) {
      if (!isCharError(error)) throw error;
      return problem(422, error.code);
    }
  });
  api.on(`POST ${base}/draft-builds`, async (request) => {
    if (!matchesVersion(request.headers()["if-match"]))
      return problem(409, "draft.version_conflict");
    const canonical = canonicalizeCreation(working);
    const previousId = byDigest.get(canonical.semantic_digest);
    const previous = previousId ? records.get(previousId) : undefined;
    if (previous) return { headers, body: previous.polled ? previous.completed : previous.pending };
    const suffix = String(++sequence).padStart(26, "0");
    const origin = {
      kind: "draft-build" as const,
      build_id: `dbld_${suffix}`,
      revision: `rev_${String(version).padStart(26, "0")}`,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    };
    const pending: DraftBuildResponse = {
      origin,
      state: "pending",
      draft_version: version,
      semantic_digest: canonical.semantic_digest,
    };
    const needsDefault =
      !["preset", "prompt-module"].includes(canonical.creation.type) &&
      !canonical.creation.assembly;
    const buildInput: BuildCreationInput = {
      root: { creation: canonical.creation, origin, visibility: "private" },
      dependencies: input.dependencies,
      ...(needsDefault ? { default_policy: input.defaultPolicy } : {}),
    };
    let completed: DraftBuildResponse;
    let artifact: unknown;
    try {
      const built = buildCreation(buildInput);
      const tests = await runAssemblyTests(buildInput);
      completed = tests.ok
        ? {
            ...pending,
            state: "ready",
            lock_digest: built.artifact.lock_digest,
            artifact_digest: built.digest,
            report: { issues: [], assembly_tests: tests.results },
          }
        : {
            ...pending,
            state: "failed",
            report: {
              issues: [
                { code: "draft_build.assembly_tests_failed", data: { results: tests.results } },
              ],
              assembly_tests: tests.results,
            },
          };
      if (tests.ok) {
        artifact = JSON.parse(built.json);
        // mockApi serializes JSON response bodies; assert it preserves the SDK's exact bytes.
        if (sha256Bytes(new TextEncoder().encode(JSON.stringify(artifact))) !== built.digest)
          throw new Error("Mock serialization changed the built artifact bytes");
      }
    } catch (error) {
      if (!isCharError(error)) throw error;
      completed = {
        ...pending,
        state: "failed",
        report: { issues: [{ code: error.code, subject: error.subject }] },
      };
    }
    records.set(origin.build_id, {
      pending,
      completed,
      ...(artifact ? { artifact } : {}),
      polled: false,
    });
    byDigest.set(canonical.semantic_digest, origin.build_id);
    api.on(`GET /v1/draft-builds/${origin.build_id}`, () => {
      const record = records.get(origin.build_id);
      if (!record) return problem(404, "not_found");
      record.polled = true;
      return { headers, body: record.completed };
    });
    api.on(`GET /v1/draft-builds/${origin.build_id}/artifact`, () => {
      const record = records.get(origin.build_id);
      return record?.completed.state === "ready" && record.artifact
        ? { headers, body: record.artifact }
        : problem(409, "draft_build.not_ready");
    });
    return { status: 202, headers, body: pending };
  });
  return records;
}
