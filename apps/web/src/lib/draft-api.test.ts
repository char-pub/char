import { buildCreation, createLocalBuildInput, sha256Bytes } from "@char-pub/core";
import { expect, it, vi } from "vitest";
import { draftBuilt, draftWorking, readyDraft } from "@/test/draft-build";
import { createRegistryClient } from "./api";

it("fetches authenticated draft artifacts and validates exact bytes and origin", async () => {
  const fetch = vi.fn(async () => new Response(draftBuilt.json));
  const client = createRegistryClient({ baseUrl: "https://registry.test", fetch });
  const signal = new AbortController().signal;
  expect(await client.draftArtifact(readyDraft, signal)).toEqual(draftBuilt.artifact);
  expect(fetch).toHaveBeenCalledWith(
    `https://registry.test/v1/draft-builds/${readyDraft.origin.build_id}/artifact`,
    expect.objectContaining({ credentials: "include", signal }),
  );
  await expect(
    client.draftArtifact({ ...readyDraft, artifact_digest: `sha256:${"a".repeat(64)}` }),
  ).rejects.toMatchObject({ code: "response.invalid" });
  const wrong = {
    ...draftBuilt.artifact,
    root: {
      ...draftBuilt.artifact.root,
      origin: { ...readyDraft.origin, revision: "rev_01j00000000000000000000001" },
    },
  };
  const bytes = JSON.stringify(wrong);
  fetch.mockImplementation(async () => new Response(bytes));
  await expect(
    client.draftArtifact({
      ...readyDraft,
      artifact_digest: sha256Bytes(new TextEncoder().encode(bytes)),
    }),
  ).rejects.toMatchObject({ code: "response.invalid" });
});

it("sends If-Match and AbortSignal for a draft build without disguising cancellation as a network failure", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(readyDraft)));
  const client = createRegistryClient({ baseUrl: "", fetch });
  const controller = new AbortController();
  await client.createDraftBuild("writer", "policy", 2, controller.signal);
  expect(fetch).toHaveBeenCalledWith(
    "/v1/creations/@writer/policy/draft-builds",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "if-match": "2" }),
      signal: controller.signal,
    }),
  );
  controller.abort();
  fetch.mockImplementation(async () => {
    throw controller.signal.reason;
  });
  await expect(
    client.draftBuild(readyDraft.origin.build_id, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("refuses a valid local artifact returned by a Registry draft endpoint", async () => {
  const local = buildCreation(createLocalBuildInput({ root: { creation: draftWorking } }));
  const client = createRegistryClient({
    baseUrl: "",
    fetch: vi.fn(async () => new Response(local.json)),
  });
  await expect(
    client.draftArtifact({
      ...readyDraft,
      artifact_digest: local.digest,
      semantic_digest: local.artifact.root.semantic_digest,
      lock_digest: local.artifact.lock_digest,
    }),
  ).rejects.toMatchObject({ code: "response.invalid" });
});
