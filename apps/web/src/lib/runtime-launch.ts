import type { ContentArtifact } from "@char-pub/assembler";
import {
  MAX_RUNTIME_LAUNCH_BYTES,
  type RuntimeLaunchRequest,
  RuntimeLaunchRequestSchema,
  RuntimeRegistryOriginSchema,
} from "@char-pub/contracts";

/** Destinations are selected by the user. They are never inferred from an OAuth callback URL. */
export function runtimeLaunchDestination(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter your Runtime's complete launch URL.");
  }
  if (
    !RuntimeRegistryOriginSchema.safeParse(url.origin).success ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS launch URL, or HTTP localhost, without credentials, a query or a fragment.",
    );
  return url.href;
}

/** Build a locator from an already authorized artifact. No content or credentials leave the platform. */
export function runtimeLaunchRequest(
  artifact: ContentArtifact,
  options: {
    registryOrigin: string;
    locale: string;
    view: RuntimeLaunchRequest["view"];
    start?: string | undefined;
  },
  now = Date.now(),
): RuntimeLaunchRequest {
  if ("origin" in artifact.root) {
    if (artifact.root.origin.kind !== "draft-build")
      throw new Error("Save and build this draft before opening it in a Runtime.");
    if (Date.parse(artifact.root.origin.expires_at) <= now)
      throw new Error("This draft build expired. Build the current draft again.");
  }
  const starts = artifact.story?.starts ?? [];
  if (starts.length > 1 && !options.start)
    throw new Error("Choose an opening before continuing to the Runtime.");
  if (options.start && !starts.some((start) => start.id === options.start))
    throw new Error("The selected opening is not part of this build.");
  if (artifact.assembly && artifact.assembly.profile.mode !== options.view.mode)
    throw new Error("Use the view fixed by this work's assembly settings.");
  if (options.view.mode === "per-agent") {
    const participant = options.view.for_participant;
    if (!artifact.ir.participants.some((entry) => entry.key === participant))
      throw new Error("Choose a participant from this build.");
  }
  const start = options.start ?? starts[0]?.id;
  return RuntimeLaunchRequestSchema.parse({
    format: "char.pub/runtime-launch",
    version: 1,
    registry_origin: options.registryOrigin,
    source: artifact.root,
    lock_digest: artifact.lock_digest,
    locale: options.locale,
    ...(start ? { start } : {}),
    view: options.view,
  });
}

/** The fragment keeps the locator out of the destination's initial HTTP request and referrer. */
export function runtimeLaunchUrl(destination: string, request: RuntimeLaunchRequest): string {
  const text = JSON.stringify(RuntimeLaunchRequestSchema.parse(request));
  if (new TextEncoder().encode(text).byteLength > MAX_RUNTIME_LAUNCH_BYTES)
    throw new Error("This launch request is too large.");
  const target = new URL(runtimeLaunchDestination(destination));
  target.hash = `launch=${encodeURIComponent(text)}`;
  return target.href;
}
