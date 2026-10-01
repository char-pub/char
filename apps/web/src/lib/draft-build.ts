import type { DraftBuildResponse } from "@char-pub/contracts";
import { z } from "zod";
import type { RegistryClient } from "./api";
import type { SavedDraftSnapshot } from "./use-draft-editor";

export type BuildPhase = "saving" | "building" | "loading";

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Cancel stops this client's wait, never deletes a server build that may already exist. */
export async function buildSavedDraft(input: {
  client: RegistryClient;
  ns: string;
  name: string;
  save: () => Promise<SavedDraftSnapshot | null>;
  signal: AbortSignal;
  onPhase?: (phase: BuildPhase) => void;
  onReceipt?: (receipt: DraftBuildResponse) => void;
  pollMs?: number;
  isCurrent?: () => boolean;
}) {
  const check = () => {
    input.signal.throwIfAborted();
    if (input.isCurrent && !input.isCurrent())
      throw new DOMException("Account or work changed", "AbortError");
  };
  check();
  input.onPhase?.("saving");
  const snapshot = await input.save();
  check();
  if (!snapshot)
    throw new Error(
      "Save the draft successfully before previewing. Your edits are kept in the editor.",
    );
  input.onPhase?.("building");
  let receipt = await input.client.createDraftBuild(
    input.ns,
    input.name,
    snapshot.version,
    input.signal,
  );
  check();
  input.onReceipt?.(receipt);
  while (receipt.state === "pending") {
    await wait(input.pollMs ?? 1000, input.signal);
    check();
    const next = await input.client.draftBuild(receipt.origin.build_id, input.signal);
    check();
    if (
      next.origin.build_id !== receipt.origin.build_id ||
      next.origin.revision !== receipt.origin.revision ||
      next.origin.expires_at !== receipt.origin.expires_at ||
      next.semantic_digest !== receipt.semantic_digest
    )
      throw new Error("The build response changed identity. Start a new preview.");
    receipt = next;
    input.onReceipt?.(receipt);
  }
  return { snapshot, receipt };
}

const TestResultsSchema = z.array(
  z.object({
    id: z.string(),
    ok: z.boolean(),
    issues: z.array(z.string()),
    messages_digest: z.string().optional(),
  }),
);
export function authorTestResults(receipt: DraftBuildResponse) {
  const report = receipt.report as
    | { assembly_tests?: unknown; issues?: { data?: { results?: unknown } }[] }
    | undefined;
  const raw =
    report?.assembly_tests ??
    (Array.isArray(report?.issues)
      ? report.issues.find((issue) => issue.data?.results)?.data?.results
      : undefined);
  const parsed = TestResultsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    receipt.state === "failed"
      ? "The draft failed its build checks before the author tests completed. Build a preview to inspect the checks."
      : "No author test results are available. Save the tests and run them again.",
  );
}
