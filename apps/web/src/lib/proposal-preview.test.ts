import { type CreationInput, canonicalizeCreation, sha256Bytes } from "@char-pub/core";
import { expect, it, vi } from "vitest";
import { sampleDefaultPolicy } from "@/fixtures/samples";
import { fakeClient } from "@/test/render";
import { buildProposalPreview, proposalSourceTexts } from "./proposal-preview";

const root: CreationInput = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/port",
  type: "scenario",
  display_name: "Port",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  cast: [{ key: "visitor", who: { late: "persona" } }],
  fragments: [
    {
      id: "premise",
      kind: "scenario",
      stable: true,
      content: { type: "text", text: "Meet at the port." },
    },
  ],
  story: {
    version: 1,
    scenes: [{ id: "port", title: "Port" }],
    endings: [{ id: "home", title: "Home", description: "The boat arrives safely." }],
  },
};
const policy = canonicalizeCreation(sampleDefaultPolicy.creation);
const exact = {
  ref: policy.creation.ref,
  release: sampleDefaultPolicy.release,
  semantic_digest: policy.semantic_digest,
};
function client() {
  return fakeClient({
    defaultPolicy: async () => exact,
    creation: async () => ({
      id: policy.creation.id,
      ref: policy.creation.ref,
      type: "preset",
      display_name: "Policy",
      rating: "general",
      tags: [],
      contribution_policy: "signed-in",
      dependents_count: 0,
      releases: [
        {
          id: exact.release,
          label: "1.0.0",
          semantic_digest: exact.semantic_digest,
          visibility: "public",
          status: "active",
          effective_rating: "general",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    }),
    releaseSource: async () => ({
      revision: "rev_01j00000000000000000000001",
      semantic_digest: exact.semantic_digest,
      creation: policy.json,
    }),
  });
}
it("builds the actual edited Story under a local origin with an exact policy and no Registry writes", async () => {
  const source = structuredClone(root);
  const artifact = await buildProposalPreview(client(), root, () => {});
  expect(artifact.root).toHaveProperty("origin.kind", "local-build");
  expect(artifact.root).not.toHaveProperty("release");
  expect(artifact.kind).toBe("content");
  if (artifact.kind !== "content") throw new Error("content");
  expect(artifact.story?.endings?.[0]?.description).toBe("The boat arrives safely.");
  expect(artifact.default_policy?.release).toBe(exact.release);
  expect(root).toEqual(source);
});
it("rejects source identity mismatches instead of compiling an unverified dependency", async () => {
  const real = client();
  const altered = fakeClient({
    ...real,
    releaseSource: async () => ({
      revision: "rev_01j00000000000000000000001",
      semantic_digest: exact.semantic_digest,
      creation: { ...policy.creation, display_name: "Forged policy" },
    }),
  });
  await expect(buildProposalPreview(altered, root, () => {})).rejects.toThrow("locked digest");
});
it("stops reading private dependencies when the account or proposal changes during a request", async () => {
  const real = client();
  let current = true;
  const releaseSource = vi.fn(real.releaseSource);
  const altered = fakeClient({
    ...real,
    releaseSource,
    creation: async (ns, name) => {
      const result = await real.creation(ns, name);
      current = false;
      return result;
    },
  });
  await expect(
    buildProposalPreview(altered, root, () => {
      if (!current) throw new Error("Changed");
    }),
  ).rejects.toThrow("Changed");
  expect(releaseSource).not.toHaveBeenCalled();
});
it("requires exact pins instead of silently following the latest version", async () => {
  await expect(
    buildProposalPreview(
      client(),
      { ...root, references: [{ id: "city", use: "@writer/city", mode: "default" }] },
      () => {},
    ),
  ).rejects.toThrow("Lock @writer/city");
});

it("accepts only matching local reference bytes and preserves BOM, CRLF and trailing spaces", async () => {
  const text = "\uFEFF# Notes\r\nThe harbor is quiet. e\u0301  \r\n";
  const bytes = new TextEncoder().encode(text);
  const asset = {
    slot: "notes",
    role: "context",
    variants: [
      {
        id: "default",
        media_type: "text/markdown",
        blob: { digest: sha256Bytes(bytes), size: bytes.length, availability: "mirrored" },
      },
    ],
  };
  const artifact = await buildProposalPreview(client(), { ...root, assets: [asset] }, () => {});
  const bodies = proposalSourceTexts(artifact, bytes);
  expect(Object.values(bodies)).toEqual([text]);
  expect(() =>
    proposalSourceTexts(artifact, new TextEncoder().encode(text.replaceAll("\r\n", "\n"))),
  ).toThrow("does not match");
});
