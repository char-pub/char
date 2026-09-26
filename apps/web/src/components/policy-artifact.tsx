import { type CreationArtifact, diffPresets } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { artifactQuery, useCreation } from "@/components/creation-context";
import { MatureGate } from "@/components/mature-gate";
import { PreviewPanel } from "@/components/preview-panel";
import { highestRating } from "@/components/rating";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useRegistry as usePolicyClient } from "@/lib/registry";
import { ConfigurationDiff } from "./configuration-diff";

export function PolicyContent({ artifact }: { artifact: CreationArtifact }) {
  if (artifact.kind === "content") return null;
  const blocks =
    artifact.kind === "preset" ? artifact.preset.policy.blocks : artifact.module.blocks;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">
        {artifact.kind === "preset" ? "Prompt policy" : "Reusable prompt module"}
      </h2>
      <p className="text-sm">
        Literal instructions with independently versioned origins. They do not change the creative
        content.
      </p>
      {blocks.length ? (
        blocks.map((block) => (
          <section key={block.id} className="space-y-2 rounded-lg border bg-surface p-4">
            <h3 className="font-mono text-sm">{block.id}</h3>
            <p className="text-xs text-text-2">
              {block.enabled === false ? "Disabled" : "Enabled"} ·{" "}
              {block.position === "main" ? "Before all regions" : "After all regions"}
            </p>
            <p className="whitespace-pre-wrap text-sm">{block.text}</p>
            {block.origin ? (
              <p className="break-all font-mono text-xs text-text-3">
                {block.origin.ref} · {block.origin.release}
              </p>
            ) : null}
          </section>
        ))
      ) : (
        <p>No local or imported blocks.</p>
      )}
      {artifact.kind === "preset" ? (
        <section className="space-y-2">
          <h3 className="font-semibold">Context layout</h3>
          <ol className="list-inside list-decimal text-sm">
            {artifact.preset.policy.layout.map((region) => (
              <li key={region}>{region}</li>
            ))}
          </ol>
          <p className="text-sm">
            Requires system messages
            {artifact.preset.policy.requires.multiple_system_messages
              ? " and multiple system messages"
              : ""}
            .
          </p>
          {Object.entries(artifact.preset.policy.region_budgets ?? {}).map(([region, tokens]) => (
            <p key={region} className="text-xs">
              {region}: up to {tokens} tokens
            </p>
          ))}
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 font-semibold">Locked sources</h3>
        <ul className="space-y-1 text-xs font-mono">
          {artifact.lock.map((item) => (
            <li key={`${item.ref}:${item.release}`} className="break-all">
              {item.ref} · {item.release}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
export function PolicyPreview() {
  const c = useCreation();
  return <PolicyPreviewSession key={`${c.me?.id ?? "anonymous"}:${c.selected?.id}`} />;
}
function PolicyPreviewSession() {
  const c = useCreation();
  const [content, setContent] = useState<CreationArtifact | null>(null);
  if (!c.artifact)
    return (
      <p role={c.artifactError ? "alert" : "status"}>
        {c.artifactError
          ? "Could not load the policy. Try loading this release again."
          : "Loading policy…"}
      </p>
    );
  const artifact = c.artifact;
  return (
    <MatureGate
      identity={c.me?.id}
      key={`${c.me?.id}:${c.selected?.id}:${content?.root.semantic_digest}`}
      rating={highestRating(c.rating, content?.meta.rating)}
      allowed={c.allowMature}
      remember={content ? content.root.semantic_digest : c.detail.ref}
      signedIn={!!c.me}
    >
      {artifact.kind === "prompt-module" ? (
        <>
          <PolicyContent artifact={artifact} />
          <p className="mt-4 text-sm">
            Import this module into a preset to test its layout and runtime capabilities.
          </p>
        </>
      ) : artifact.kind === "preset" ? (
        <div className="space-y-5">
          <ArtifactPicker
            label="Choose content to preview with this preset"
            types={[
              "character",
              "scenario",
              "world",
              "lorebook",
              "persona",
              "style",
              "relationship",
            ]}
            onPick={({ artifact: selected }) => setContent(selected)}
          />
          {content?.kind === "content" ? (
            <PreviewPanel
              key={`${content.root.release}:${artifact.root.release}`}
              ir={content.ir}
              preset={artifact.preset}
            />
          ) : (
            <p className="text-sm">
              Select a content release. The preset supplies policy, while the content supplies the
              story.
            </p>
          )}
        </div>
      ) : null}
    </MatureGate>
  );
}
export function PolicyVersions() {
  const c = useCreation();
  const available = c.detail.releases.filter((r) => r.status !== "tombstoned");
  const [from, setFrom] = useState(available[1]?.label ?? "");
  const [to, setTo] = useState(available[0]?.label ?? "");
  const client = usePolicyClient();
  const before = useQuery(
    artifactQuery(
      client,
      c.ns,
      c.name,
      available.find((r) => r.label === from),
      c.me?.id ?? null,
    ),
  );
  const after = useQuery(
    artifactQuery(
      client,
      c.ns,
      c.name,
      available.find((r) => r.label === to),
      c.me?.id ?? null,
    ),
  );
  const a = before.data;
  const b = after.data;
  const diff =
    a?.kind === "preset" && b?.kind === "preset" ? diffPresets(a.preset, b.preset) : null;
  const blocksA =
    a?.kind === "preset"
      ? a.preset.policy.blocks
      : a?.kind === "prompt-module"
        ? a.module.blocks
        : [];
  const blocksB =
    b?.kind === "preset"
      ? b.preset.policy.blocks
      : b?.kind === "prompt-module"
        ? b.module.blocks
        : [];
  const blockIds = [...new Set([...blocksA.map((x) => x.id), ...blocksB.map((x) => x.id)])];
  const changedIds = blockIds.filter(
    (id) =>
      JSON.stringify(blocksA.find((x) => x.id === id)) !==
      JSON.stringify(blocksB.find((x) => x.id === id)),
  );
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Policy versions</h2>
      <div className="flex gap-3">
        {(["from", "to"] as const).map((side) => (
          <Label key={side} className="flex-1 text-sm">
            {side === "from" ? "Compare from" : "Compare to"}
            <NativeSelect
              value={side === "from" ? from : to}
              onChange={(e) => (side === "from" ? setFrom(e.target.value) : setTo(e.target.value))}
            >
              <option value="">Choose version</option>
              {available.map((release) => (
                <option key={release.id} value={release.label}>
                  {release.label}
                  {release.status === "yanked" ? " (yanked)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Label>
        ))}
      </div>
      {available.length < 2 ? (
        <p>Publish two versions to compare changes.</p>
      ) : before.isError || after.isError ? (
        <p role="alert">Could not load the selected versions.</p>
      ) : a && b ? (
        <MatureGate
          identity={c.me?.id}
          key={`${c.me?.id}:${a.root.release}:${b.root.release}`}
          rating={highestRating(c.rating, a.meta.rating, b.meta.rating)}
          allowed={c.allowMature}
          remember={a.root.semantic_digest + b.root.semantic_digest}
          signedIn={!!c.me}
        >
          <div className="space-y-4">
            <p className="text-sm">
              {a.root.semantic_digest === b.root.semantic_digest
                ? "Same semantic snapshot."
                : "Different semantic snapshots. Policy changes are shown below; metadata can also change the snapshot."}
            </p>
            {diff ? (
              <p className="text-sm">
                {diff.blocks.added.length} blocks added · {diff.blocks.removed.length} removed ·{" "}
                {diff.blocks.modified.length} modified.{" "}
                {diff.blocks.order_changed
                  ? "Shared blocks reordered."
                  : "Shared block order unchanged."}{" "}
                {diff.policy_changes.length
                  ? `Changed settings: ${diff.policy_changes.join(", ")}.`
                  : ""}
              </p>
            ) : (
              <p className="text-sm">
                {blocksA.map((x) => x.id).join() !== blocksB.map((x) => x.id).join()
                  ? "Module block order changed."
                  : "Module block order unchanged."}
              </p>
            )}
            {changedIds.map((id) => (
              <section key={id} className="space-y-2 rounded-lg border p-3">
                <h3 className="font-mono text-sm">{id}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[blocksA, blocksB].map((blocks, index) => {
                    const block = blocks.find((x) => x.id === id);
                    return (
                      <div key={index} className="rounded bg-surface-2 p-3">
                        <h4 className="text-xs font-semibold">{index === 0 ? from : to}</h4>
                        <p className="whitespace-pre-wrap text-sm">
                          {block?.text ?? "Not present"}
                        </p>
                        {block ? (
                          <p className="text-xs">
                            {block.position} · {block.enabled === false ? "disabled" : "enabled"}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {diff?.lock_changes?.length ? (
              <section>
                <h3 className="font-semibold">Dependency version changes</h3>
                {diff.lock_changes.map((change) => (
                  <p key={change.ref} className="break-all font-mono text-xs">
                    {change.ref}: {change.from?.release ?? "not present"} →{" "}
                    {change.to?.release ?? "removed"}
                  </p>
                ))}
              </section>
            ) : null}
            {diff?.origin_changes?.length ? (
              <section>
                <h3 className="font-semibold">Block source changes</h3>
                {diff.origin_changes.map((change) => (
                  <p key={change.id} className="break-all font-mono text-xs">
                    {change.id}: {change.from?.release ?? "local"} → {change.to?.release ?? "local"}
                  </p>
                ))}
              </section>
            ) : null}
            {JSON.stringify(a.meta) !== JSON.stringify(b.meta) ? (
              <section>
                <h3 className="font-semibold">Publication metadata changed</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[a, b].map((item, index) => (
                    <div key={index} className="rounded border p-3 text-sm">
                      <strong>{index === 0 ? from : to}</strong>
                      <p>Rating: {item.meta.rating}</p>
                      {item.meta.licenses.map((license) => (
                        <p key={`${license.ref}:${license.asset ?? ""}`} className="text-xs">
                          {license.ref}: {license.license}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {a.lock_digest !== b.lock_digest ? (
              <p className="text-sm">Locked dependency versions changed.</p>
            ) : null}
          </div>
        </MatureGate>
      ) : (
        <p role="status">Choose versions to compare.</p>
      )}
      {c.detail.type === "preset" ? <ConfigurationDiff from={from} to={to} /> : null}
    </div>
  );
}
