import { CREATIVE_REGIONS, PRESET_REGIONS } from "@char-pub/core";
import { useId } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { nextId, type Working } from "@/lib/draft";

interface Block {
  id: string;
  text: string;
  position: "main" | "after-history";
  enabled?: boolean;
}
interface PolicyImport {
  id: string;
  use: string;
  pin: { release: string; semantic_digest: string };
}
export interface EditablePolicy {
  version: "0-draft";
  blocks: Block[];
  imports?: PolicyImport[];
  layout?: string[];
  region_budgets?: Record<string, number>;
  requires?: { system_role: true; multiple_system_messages?: true };
}
export function defaultPolicy(module = false): EditablePolicy {
  return {
    version: "0-draft",
    blocks: [],
    ...(module ? {} : { layout: [...PRESET_REGIONS], requires: { system_role: true as const } }),
  };
}
export function reorder<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const result = [...items];
  const other = index + direction;
  if (index < 0 || other < 0 || index >= items.length || other >= items.length) return result;
  const a = result[index];
  const b = result[other];
  if (a !== undefined && b !== undefined) {
    result[index] = b;
    result[other] = a;
  }
  return result;
}
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  multiline?: boolean;
  type?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {multiline ? (
        <Textarea id={id} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
export function MoveButtons({
  index,
  length,
  onMove,
  label,
}: {
  index: number;
  length: number;
  label: string;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <span className="flex gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Move ${label} down`}
        disabled={index === length - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
    </span>
  );
}

export function PolicyEditor({
  working,
  update,
  module = false,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  module?: boolean;
}) {
  const key = module ? "prompt_module" : "policy";
  const policy = (working[key] as EditablePolicy | undefined) ?? defaultPolicy(module);
  const set = (patch: Partial<EditablePolicy>) =>
    update((w) => ({
      ...w,
      [key]: { ...((w[key] as EditablePolicy | undefined) ?? defaultPolicy(module)), ...patch },
    }));
  const blocks = policy.blocks ?? [];
  const change = (index: number, patch: Partial<Block>) =>
    set({ blocks: blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
  const imports = policy.imports ?? [];
  return (
    <section id="edit-policy" className="space-y-5 rounded-xl border bg-surface p-5">
      <h2 className="text-xl font-bold">{module ? "Reusable prompt module" : "Prompt policy"}</h2>
      <p className="text-sm text-text-2">
        Instructions are literal text. Block IDs stay stable when you edit or reorder them. Imported
        modules run before local blocks.
      </p>
      <ol className="space-y-4" aria-label="Prompt blocks">
        {blocks.map((b, i) => (
          <li key={i} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <Field
                  label={`Block ${i + 1} ID`}
                  value={b.id}
                  onChange={(id) => change(i, { id })}
                />
              </div>
              <MoveButtons
                index={i}
                length={blocks.length}
                label={b.id}
                onMove={(d) => set({ blocks: reorder(blocks, i, d) })}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => set({ blocks: blocks.filter((_, n) => n !== i) })}
              >
                Remove block
              </Button>
            </div>
            <Field
              label={`Instructions for ${b.id}`}
              value={b.text}
              multiline
              onChange={(text) => change(i, { text })}
            />
            <div className="flex gap-4">
              <Label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={b.enabled !== false}
                  onChange={(e) => change(i, { enabled: e.target.checked })}
                />
                Enabled
              </Label>
              <Label className="flex items-center gap-2 text-sm">
                Position
                <NativeSelect
                  value={b.position}
                  onChange={(e) => change(i, { position: e.target.value as Block["position"] })}
                >
                  <option value="main">Before all regions</option>
                  <option value="after-history">After all regions</option>
                </NativeSelect>
              </Label>
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          set({
            blocks: [
              ...blocks,
              {
                id: nextId(
                  blocks.map((b) => b.id),
                  "instructions",
                ),
                text: "Write your instructions here.",
                position: "main",
              },
            ],
          })
        }
      >
        Add prompt block
      </Button>
      <section className="space-y-2">
        <h3 className="font-semibold">Versioned module imports</h3>
        {imports.map((item, i) => (
          <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
            <span className="flex-1 font-mono text-xs">
              {item.use} · {item.pin.release}
            </span>
            <MoveButtons
              index={i}
              length={imports.length}
              label={item.id}
              onMove={(d) => set({ imports: reorder(imports, i, d) })}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => set({ imports: imports.filter((_, n) => n !== i) })}
            >
              Remove import
            </Button>
          </div>
        ))}
        <ArtifactPicker
          label="Add a module"
          types={["prompt-module"]}
          onPick={({ artifact }) => {
            const root = artifact.root;
            if (imports.some((x) => x.use === root.ref)) {
              set({
                imports: imports.map((item) =>
                  item.use === root.ref
                    ? {
                        ...item,
                        pin: { release: root.release, semantic_digest: root.semantic_digest },
                      }
                    : item,
                ),
              });
              return;
            }
            set({
              imports: [
                ...imports,
                {
                  id: nextId(
                    imports.map((x) => x.id),
                    "module",
                  ),
                  use: root.ref,
                  pin: { release: root.release, semantic_digest: root.semantic_digest },
                },
              ],
            });
          }}
        />
      </section>
      {!module ? (
        <>
          <section className="space-y-2">
            <h3 className="font-semibold">Context layout</h3>
            <p className="text-xs text-text-2">
              Each region appears once. Move regions before or after history; history messages keep
              their own order.
            </p>
            <ol aria-label="Context layout" className="space-y-1">
              {(policy.layout ?? PRESET_REGIONS).map((region, i, list) => (
                <li key={region} className="flex items-center gap-2 rounded bg-surface-2 px-3 py-1">
                  <span className="flex-1 text-sm">
                    {region.replace(/^(system|session):/, "").replaceAll("_", " ")}
                  </span>
                  <MoveButtons
                    index={i}
                    length={list.length}
                    label={region}
                    onMove={(d) => set({ layout: reorder(list, i, d) })}
                  />
                </li>
              ))}
            </ol>
          </section>
          <details>
            <summary className="cursor-pointer font-semibold">
              Region budgets and runtime capabilities
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {CREATIVE_REGIONS.map((region) => (
                <Field
                  key={region}
                  label={`${region.slice(7)} token limit`}
                  type="number"
                  value={policy.region_budgets?.[region] ?? ""}
                  onChange={(text) => {
                    const limits = { ...policy.region_budgets };
                    if (text === "") delete limits[region];
                    else limits[region] = Number(text);
                    set({ region_budgets: limits });
                  }}
                />
              ))}
            </div>
            <p className="my-2 text-xs">
              Empty means no local limit. Limits do not reserve tokens. System-role support is
              required.
            </p>
            <Label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={policy.requires?.multiple_system_messages === true}
                onChange={(e) =>
                  set({
                    requires: {
                      system_role: true,
                      ...(e.target.checked ? { multiple_system_messages: true as const } : {}),
                    },
                  })
                }
              />
              Require multiple system messages
            </Label>
          </details>
        </>
      ) : null}
    </section>
  );
}
