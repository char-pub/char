import type { Binding, CastMember, CreationType, ParamDecl, SlotDecl } from "@char-pub/core";
import { useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { getReferences, nextId, setMeta, type Working } from "@/lib/draft";
import { castReferences, storyOf, storyRestoreError } from "@/lib/story-editor";
import { castAnchor } from "./anchors";
import { Field } from "./policy-editor";

function bindingText(value: Binding | undefined): string {
  return typeof value === "string" ? value : value ? `late:${value.late}` : "";
}
function bindingValue(value: string): Binding {
  return value.startsWith("late:") ? { late: value.slice(5) as "persona" | "character" } : value;
}
export function BindingField({
  label,
  value,
  onChange,
  working,
  forCast = false,
}: {
  label: string;
  value: Binding | undefined;
  onChange: (b: Binding) => void;
  forCast?: boolean;
  working: Working;
}) {
  const values = [
    ...new Set(
      [
        "late:persona",
        "late:character",
        ...(forCast
          ? ((working.cast as CastMember[] | undefined) ?? []).flatMap((c) =>
              typeof c.who === "string" && c.who.startsWith("@") ? [c.who] : [],
            )
          : [
              "{{self}}",
              ...getReferences(working).map((r) => String(r.use)),
              ...((working.cast as CastMember[] | undefined) ?? []).map((c) => `{{cast:${c.key}}}`),
            ]),
        bindingText(value),
      ].filter(Boolean),
    ),
  ];
  return (
    <Label className="block space-y-1 text-sm">
      <span>{label}</span>
      <NativeSelect
        value={bindingText(value)}
        onChange={(e) => onChange(bindingValue(e.target.value))}
      >
        {!value ? <option value="">Choose a binding</option> : null}
        {values.map((v) => (
          <option key={v} value={v}>
            {v === "late:persona"
              ? "Persona supplied at runtime"
              : v === "late:character"
                ? "Character supplied at runtime"
                : v}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );
}

export function CompositionEditor({
  castOnly = false,
  type,
  working,
  update,
}: {
  castOnly?: boolean;
  type: CreationType;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
}) {
  const [removedCast, setRemovedCast] = useState<{
    member: CastMember;
    index: number;
    references: ReturnType<typeof getReferences>;
    baseline: Working;
  }>();
  const [undoError, setUndoError] = useState("");
  const slots = (working.slots as Record<string, SlotDecl> | undefined) ?? {};
  const cast = (working.cast as CastMember[] | undefined) ?? [];
  const params = (working.params as Record<string, ParamDecl> | undefined) ?? {};
  const refs = getReferences(working);
  const setSlots = (value: Record<string, SlotDecl>) => update((w) => ({ ...w, slots: value }));
  const renameSlot = (key: string, next: string) => {
    const entries = Object.entries(slots).map(([k, v]) => [k === key ? next : k, v]);
    setSlots(Object.fromEntries(entries));
  };
  const setCast = (value: CastMember[]) => update((w) => ({ ...w, cast: value }));
  return (
    <section id="edit-composition" className="space-y-5 rounded-xl border bg-surface p-5">
      <h2 className="text-xl font-bold">
        {type === "scenario" ? "Cast and roles" : "Roles and bindings"}
      </h2>
      {undoError ? (
        <p role="alert" className="text-sm text-danger">
          {undoError}
        </p>
      ) : null}
      {type === "scenario" ? (
        <section className="space-y-3">
          <h3 className="font-semibold">Cast</h3>
          <p className="text-sm text-text-2">
            Published cast members must also be locked as content dependencies. Runtime roles
            receive separate session bindings.
          </p>
          {cast.map((member, i) => (
            <div
              id={castAnchor(member.key)}
              key={i}
              className="grid gap-3 rounded border p-3 sm:grid-cols-2"
            >
              {storyOf(working) ? (
                <p className="text-sm">
                  Stable role key: <code>{member.key}</code>
                </p>
              ) : (
                <Field
                  label={`Cast ${i + 1} key`}
                  value={member.key}
                  onChange={(key) => setCast(cast.map((m, n) => (n === i ? { ...m, key } : m)))}
                />
              )}
              <BindingField
                label={`Binding for ${member.key}`}
                forCast
                working={working}
                value={member.who}
                onChange={(who) => setCast(cast.map((m, n) => (n === i ? { ...m, who } : m)))}
              />
              <Label className="text-sm">
                Role
                <NativeSelect
                  value={member.role ?? "support"}
                  onChange={(e) =>
                    setCast(
                      cast.map((m, n) =>
                        n === i ? { ...m, role: e.target.value as CastMember["role"] } : m,
                      ),
                    )
                  }
                >
                  <option value="lead">Lead</option>
                  <option value="support">Support</option>
                  <option value="user">User</option>
                </NativeSelect>
              </Label>
              <Button
                type="button"
                variant="ghost"
                disabled={castReferences(working, member.key).length > 0}
                onClick={() => {
                  update((w) =>
                    castReferences(w, member.key).length
                      ? w
                      : {
                          ...w,
                          cast: ((w.cast as CastMember[] | undefined) ?? []).filter(
                            (m) => m.key !== member.key,
                          ),
                        },
                  );
                  setRemovedCast({
                    member,
                    index: i,
                    references: getReferences(working),
                    baseline: working,
                  });
                }}
              >
                Remove cast member
              </Button>
              {castReferences(working, member.key).length ? (
                <p className="text-xs text-text-2">
                  Remove its references first: {castReferences(working, member.key).join(", ")}
                </p>
              ) : null}
            </div>
          ))}
          {removedCast ? (
            <div role="status" className="flex items-center gap-2 text-sm">
              Cast member removed.
              <Button
                variant="outline"
                disabled={cast.some((m) => m.key === removedCast.member.key)}
                onClick={() => {
                  const candidate = (w: Working): Working => {
                    const list = [...((w.cast as CastMember[] | undefined) ?? [])];
                    if (list.some((m) => m.key === removedCast.member.key)) return w;
                    list.splice(Math.min(removedCast.index, list.length), 0, removedCast.member);
                    return { ...w, cast: list };
                  };
                  const dependenciesChanged =
                    typeof removedCast.member.who === "string" &&
                    removedCast.references.some(
                      (previous) =>
                        !getReferences(working).some(
                          (current) => JSON.stringify(current) === JSON.stringify(previous),
                        ),
                    );
                  const error = dependenciesChanged
                    ? "Dependencies changed. Restore the previous dependencies or add this character again using the version picker."
                    : storyRestoreError(working, candidate(working), removedCast.baseline);
                  setUndoError(error ?? "");
                  if (error) return;
                  update((w) => {
                    const next = candidate(w);
                    return storyRestoreError(w, next, removedCast.baseline) ? w : next;
                  });
                  setRemovedCast(undefined);
                }}
              >
                Undo cast removal
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setCast([
                ...cast,
                {
                  key: nextId(
                    cast.map((m) => m.key),
                    "role",
                  ),
                  who: { late: "persona" },
                  role: "user",
                },
              ])
            }
          >
            Add runtime role
          </Button>
          <ArtifactPicker
            label="Add a published cast member"
            types={["character", "persona"]}
            onPick={({ artifact }) => {
              const root = artifact.root;
              update((w) => {
                const current = (w.cast as CastMember[] | undefined) ?? [];
                const references = getReferences(w);
                return {
                  ...w,
                  cast: [
                    ...current,
                    {
                      key: nextId(
                        current.map((m) => m.key),
                        root.ref.split("/")[1] ?? "role",
                      ),
                      who: root.ref,
                      role: "support",
                    },
                  ],
                  references: references.some((r) => r.use === root.ref)
                    ? references.map((r) =>
                        r.use === root.ref
                          ? {
                              ...r,
                              pin: { release: root.release, semantic_digest: root.semantic_digest },
                            }
                          : r,
                      )
                    : [
                        ...references,
                        {
                          id: nextId(
                            references.map((r) => r.id),
                            "cast",
                          ),
                          use: root.ref,
                          mode: "intrinsic",
                          pin: { release: root.release, semantic_digest: root.semantic_digest },
                        },
                      ],
                };
              });
            }}
          />
        </section>
      ) : null}
      {!castOnly ? (
        <>
          <details open={type === "relationship"}>
            <summary className="cursor-pointer font-semibold">Named role slots</summary>
            <p className="my-2 text-xs">
              Relationships need at least two slots. Refer to a slot in text using {"{{slot:name}}"}
              .
            </p>
            <div className="space-y-3">
              {Object.entries(slots).map(([key, slot], slotIndex) => (
                <div key={slotIndex} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
                  <Field
                    label={`Slot ${key} name`}
                    value={key}
                    onChange={(next) => renameSlot(key, next)}
                  />
                  <Label className="text-sm">
                    Accepts
                    <NativeSelect
                      value={Array.isArray(slot.accepts) ? slot.accepts[0] : slot.accepts}
                      onChange={(e) =>
                        setSlots({
                          ...slots,
                          [key]: { ...slot, accepts: e.target.value as CreationType },
                        })
                      }
                    >
                      {["character", "persona", "world", "scenario"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={slot.required !== false}
                      onChange={(e) =>
                        setSlots({ ...slots, [key]: { ...slot, required: e.target.checked } })
                      }
                    />
                    Required
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      const next = { ...slots };
                      delete next[key];
                      setSlots(next);
                    }}
                  >
                    Remove slot
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() =>
                setSlots({
                  ...slots,
                  [nextId(Object.keys(slots), "role")]: { accepts: "character", required: true },
                })
              }
            >
              Add slot
            </Button>
          </details>
          {refs.length ? (
            <details>
              <summary className="cursor-pointer font-semibold">Dependency role bindings</summary>
              <p className="my-2 text-xs">
                Bind the slots declared by each referenced relationship or other creation. Keys must
                match its declared slot names.
              </p>
              {refs.map((edge, index) => {
                const bindings = edge.bind ?? {};
                const replace = (value: typeof bindings) =>
                  update((w) => ({
                    ...w,
                    references: getReferences(w).map((r, i) =>
                      i === index ? { ...r, bind: value } : r,
                    ),
                  }));
                return (
                  <fieldset key={edge.id} className="my-3 space-y-2 rounded border p-3">
                    <legend className="font-mono text-xs">{String(edge.use)}</legend>
                    {Object.entries(bindings).map(([key, value], bindingIndex) => (
                      <div key={bindingIndex} className="grid gap-2 sm:grid-cols-3">
                        <Field
                          label="Target slot"
                          value={key}
                          onChange={(next) =>
                            replace(
                              Object.fromEntries(
                                Object.entries(bindings).map(([k, v]) => [k === key ? next : k, v]),
                              ),
                            )
                          }
                        />
                        <BindingField
                          label={`Bind ${key}`}
                          value={value}
                          onChange={(b) => replace({ ...bindings, [key]: b })}
                          working={working}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            const next = { ...bindings };
                            delete next[key];
                            replace(next);
                          }}
                        >
                          Remove binding
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        replace({
                          ...bindings,
                          [nextId(Object.keys(bindings), "role")]: "{{self}}",
                        })
                      }
                    >
                      Add binding
                    </Button>
                  </fieldset>
                );
              })}
            </details>
          ) : null}
          <details>
            <summary className="cursor-pointer font-semibold">Parameters</summary>
            {Object.entries(params).map(([key, param], paramIndex) => (
              <div key={paramIndex} className="my-2 grid gap-2 sm:grid-cols-3">
                <Field
                  label="Parameter name"
                  value={key}
                  onChange={(next) =>
                    update((w) => ({
                      ...w,
                      params: Object.fromEntries(
                        Object.entries(params).map(([k, v]) => [k === key ? next : k, v]),
                      ),
                    }))
                  }
                />
                <Label className="text-sm">
                  Type
                  <NativeSelect
                    value={param.type}
                    onChange={(e) =>
                      update((w) => ({
                        ...w,
                        params: { ...params, [key]: { type: e.target.value } },
                      }))
                    }
                  >
                    {["string", "number", "boolean"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </NativeSelect>
                </Label>
                <Field
                  label="Default value"
                  value={String(param.default ?? "")}
                  onChange={(value) =>
                    update((w) => ({
                      ...w,
                      params: {
                        ...params,
                        [key]: {
                          ...param,
                          default:
                            param.type === "number"
                              ? Number(value)
                              : param.type === "boolean"
                                ? value === "true"
                                : value,
                        },
                      },
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    update((w) => {
                      const next = { ...params };
                      delete next[key];
                      return { ...w, params: next };
                    })
                  }
                >
                  Remove parameter
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() =>
                update((w) => ({
                  ...w,
                  params: {
                    ...params,
                    [nextId(Object.keys(params), "setting")]: { type: "string", default: "" },
                  },
                }))
              }
            >
              Add parameter
            </Button>
          </details>
          <section className="space-y-2">
            <h3 className="font-semibold">Recommended presets</h3>
            <p className="text-xs">Recommendations do not lock or activate a preset.</p>
            {working.meta?.recommended_presets?.map((ref) => (
              <div key={ref} className="flex items-center gap-2 text-sm">
                <span className="flex-1 font-mono">{ref}</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    update((w) =>
                      setMeta(w, {
                        recommended_presets: w.meta?.recommended_presets?.filter((r) => r !== ref),
                      }),
                    )
                  }
                >
                  Remove recommendation
                </Button>
              </div>
            ))}
            <ArtifactPicker
              label="Recommend a preset"
              types={["preset"]}
              onPick={({ artifact }) =>
                update((w) =>
                  setMeta(w, {
                    recommended_presets: [
                      ...new Set([...(w.meta?.recommended_presets ?? []), artifact.root.ref]),
                    ],
                  }),
                )
              }
            />
          </section>
        </>
      ) : null}
    </section>
  );
}
