import {
  type Fragment,
  type FragmentContent,
  FragmentContentSchema,
  LocaleSchema,
} from "@char-pub/core";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { localeOf, type Working } from "@/lib/draft";
import { speakerError, speakerOptions } from "@/lib/fragment-metadata";

type Variant = { content: FragmentContent; activation_keys?: string[] | undefined };
function valueAt(fragment: Fragment, locale: string): Variant | undefined {
  return locale ? fragment.locale?.[locale] : { content: fragment.content };
}
function replaceAt(fragment: Fragment, locale: string, value: Variant | undefined): Fragment {
  if (!locale) return value ? { ...fragment, content: value.content } : fragment;
  const variants = { ...fragment.locale };
  if (value) variants[locale] = value;
  else delete variants[locale];
  const { locale: _, ...rest } = fragment;
  return Object.keys(variants).length ? { ...rest, locale: variants } : rest;
}
function assets(w: Working): { ref: string; label: string }[] {
  return (w.assets ?? [])
    .filter((asset) => asset.role === "context")
    .flatMap((asset) => [
      { ref: `#asset/${asset.slot}`, label: `${asset.slot} (default)` },
      ...asset.variants.map((v) => ({
        ref: `#asset/${asset.slot}/${v.id}`,
        label: `${asset.slot} / ${v.id} (${v.media_type})`,
      })),
    ]);
}
function targetError(w: Working, value: FragmentContent): string | undefined {
  if (value.type === "media" && !assets(w).some((a) => a.ref === value.asset))
    return `Asset ${value.asset} is no longer available. Add it before restoring this content.`;
  if (value.type === "dialogue")
    return value.turns
      .map((turn) => speakerError(w, turn.speaker))
      .find((error): error is string => !!error);
  return undefined;
}

/** Structured editors retain sibling translations; destructive content changes have local Undo. */
export function FragmentContentEditor({
  working,
  fragment,
  onChange,
  onPendingChange,
  textInBasics = false,
}: {
  working: Working;
  fragment: Fragment;
  onChange: (next: Fragment) => void;
  onPendingChange?: ((key: string, pending: boolean) => void) | undefined;
  textInBasics?: boolean;
}) {
  const id = useId();
  const [locale, setLocale] = useState("");
  const [newLocale, setNewLocale] = useState("");
  const [nextType, setNextType] = useState<FragmentContent["type"] | "">("");
  const [error, setError] = useState("");
  const [jsonEdit, setJsonEdit] = useState<{ text: string; baseline: FragmentContent } | null>(
    null,
  );
  const [undo, setUndo] = useState<{
    locale: string;
    before?: Variant;
    after?: Variant;
    references: unknown;
  } | null>(null);
  const active = valueAt(fragment, locale);
  const content = active?.content;
  const options = assets(working);
  const speakers = speakerOptions(working);
  const pending = jsonEdit !== null;
  useEffect(() => {
    onPendingChange?.(id, pending);
    return () => onPendingChange?.(id, false);
  }, [id, pending, onPendingChange]);
  useEffect(() => {
    if (!pending) return;
    const protect = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [pending]);
  const change = (next: FragmentContent, recover = false) => {
    const after: Variant = { ...active, content: next };
    if (recover)
      setUndo({
        locale,
        ...(active ? { before: structuredClone(active) } : {}),
        after: structuredClone(after),
        references: structuredClone(working.references),
      });
    onChange(replaceAt(fragment, locale, after));
    setError("");
  };
  return (
    <section aria-label={`Content for ${fragment.id}`} className="space-y-3">
      <Label className="block text-xs">
        Content language
        <NativeSelect
          aria-label="Content language"
          value={locale}
          disabled={pending}
          onChange={(e) => {
            setLocale(e.target.value);
            setNextType("");
            setError("");
          }}
        >
          <option value="">Default ({localeOf(working)})</option>
          {Object.keys(fragment.locale ?? {}).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </NativeSelect>
      </Label>
      <details>
        <summary className="cursor-pointer text-xs">Translations</summary>
        <p className="text-xs">
          Each language has its own content. Other translations and translated keywords stay
          unchanged.
        </p>
        <Input
          aria-label="New content language"
          value={newLocale}
          disabled={pending}
          onChange={(e) => setNewLocale(e.target.value)}
          placeholder="e.g. ja"
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (
              !LocaleSchema.safeParse(newLocale).success ||
              newLocale === localeOf(working) ||
              Object.hasOwn(fragment.locale ?? {}, newLocale)
            ) {
              setError("Choose a new valid language code other than the default language.");
              return;
            }
            const after = { content: structuredClone(fragment.content) };
            setUndo({ locale: newLocale, after, references: structuredClone(working.references) });
            onChange(replaceAt(fragment, newLocale, after));
            setLocale(newLocale);
            setNewLocale("");
            setError("");
          }}
        >
          Add content translation
        </Button>
        {locale && active ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setUndo({
                locale,
                before: structuredClone(active),
                references: structuredClone(working.references),
              });
              onChange(replaceAt(fragment, locale, undefined));
              setLocale("");
              setError("");
            }}
          >
            Remove this translation
          </Button>
        ) : null}
      </details>
      {jsonEdit && content?.type !== "structured" ? (
        <div className="space-y-2">
          <p role="alert">
            The source content changed. Copy your unapplied JSON before discarding this buffer.
          </p>
          <Textarea
            aria-label="Unapplied JSON from previous content"
            readOnly
            value={jsonEdit.text}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setJsonEdit(null);
              setError("");
            }}
          >
            Discard JSON edits
          </Button>
        </div>
      ) : null}
      {!content ? (
        <p role="alert">This translation was removed. Select another language.</p>
      ) : (
        <>
          <p className="text-xs">Content type: {content.type}</p>
          {content.type === "text" ? (
            <>
              {!locale && textInBasics ? (
                <p className="text-xs">Edit the default text in The basics above.</p>
              ) : (
                <Label className="block text-xs">
                  Text
                  <Textarea
                    aria-label="Text"
                    rows={4}
                    value={content.text}
                    onChange={(e) => change({ ...content, text: e.target.value })}
                  />
                </Label>
              )}
              <Label className="block text-xs">
                Text format
                <NativeSelect
                  aria-label="Text format"
                  value={content.format ?? "markdown"}
                  onChange={(e) =>
                    change({ ...content, format: e.target.value as "plain" | "markdown" })
                  }
                >
                  <option value="markdown">Markdown</option>
                  <option value="plain">Plain text</option>
                </NativeSelect>
              </Label>
            </>
          ) : null}
          {content.type === "dialogue" ? (
            <div className="space-y-3">
              <p className="text-xs">
                Example dialogue, in order. Speakers use real roles; public references are checked
                when you build.
              </p>
              {content.turns.map((turn, index) => (
                <fieldset key={index} className="space-y-2 rounded border p-3">
                  <legend>Dialogue turn {index + 1}</legend>
                  <Label className="block text-xs">
                    Speaker
                    <NativeSelect
                      aria-label={`Speaker for turn ${index + 1}`}
                      value={turn.speaker}
                      onChange={(e) =>
                        change({
                          ...content,
                          turns: content.turns.map((t, i) =>
                            i === index ? { ...t, speaker: e.target.value } : t,
                          ),
                        })
                      }
                    >
                      {!speakers.some((s) => s.value === turn.speaker) ? (
                        <option value={turn.speaker}>{turn.speaker} (current reference)</option>
                      ) : null}
                      {speakers.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Label className="block text-xs">
                    Speaker reference
                    <Input
                      aria-label={`Speaker reference for turn ${index + 1}`}
                      value={turn.speaker}
                      onChange={(e) =>
                        change({
                          ...content,
                          turns: content.turns.map((t, i) =>
                            i === index ? { ...t, speaker: e.target.value } : t,
                          ),
                        })
                      }
                    />
                  </Label>
                  {speakerError(working, turn.speaker) ? (
                    <p role="alert" className="text-xs">
                      {speakerError(working, turn.speaker)}
                    </p>
                  ) : null}
                  <Label className="block text-xs">
                    Dialogue text
                    <Textarea
                      aria-label={`Text for turn ${index + 1}`}
                      value={turn.text}
                      onChange={(e) =>
                        change({
                          ...content,
                          turns: content.turns.map((t, i) =>
                            i === index ? { ...t, text: e.target.value } : t,
                          ),
                        })
                      }
                    />
                  </Label>
                  {[-1, 1].map((direction) => (
                    <Button
                      key={direction}
                      type="button"
                      variant="outline"
                      disabled={index + direction < 0 || index + direction >= content.turns.length}
                      onClick={() => {
                        const turns = [...content.turns];
                        const other = turns[index + direction];
                        if (!other) return;
                        turns[index] = other;
                        turns[index + direction] = turn;
                        change({ ...content, turns }, true);
                      }}
                    >
                      {direction < 0 ? "Move turn up" : "Move turn down"}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={content.turns.length === 1}
                    onClick={() =>
                      change(
                        { ...content, turns: content.turns.filter((_, i) => i !== index) },
                        true,
                      )
                    }
                  >
                    Remove turn
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  change(
                    { ...content, turns: [...content.turns, { speaker: "{{user}}", text: "" }] },
                    true,
                  )
                }
              >
                Add dialogue turn
              </Button>
            </div>
          ) : null}
          {content.type === "media" ? (
            <>
              <Label className="block text-xs">
                Context asset
                <NativeSelect
                  aria-label="Context asset"
                  value={content.asset}
                  onChange={(e) => change({ ...content, asset: e.target.value })}
                >
                  {!options.some((a) => a.ref === content.asset) ? (
                    <option value={content.asset}>{content.asset} (missing context asset)</option>
                  ) : null}
                  {options.map((a) => (
                    <option key={a.ref} value={a.ref}>
                      {a.label}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
              {!options.length ? (
                <p className="text-xs">
                  Add a context asset before selecting media. A presentation-only avatar is not
                  model context.
                </p>
              ) : null}
              {targetError(working, content) ? (
                <p role="alert" className="text-xs">
                  {targetError(working, content)}
                </p>
              ) : null}
              <Label className="block text-xs">
                Media caption
                <Textarea
                  aria-label="Media caption"
                  value={content.caption ?? ""}
                  onChange={(e) => {
                    const { caption: _, ...rest } = content;
                    change(e.target.value ? { ...rest, caption: e.target.value } : rest);
                  }}
                />
              </Label>
            </>
          ) : null}
          {content.type === "structured" ? (
            <>
              <Label className="block text-xs">
                Structured schema
                <Input
                  aria-label="Structured schema"
                  value={content.schema}
                  disabled={pending}
                  onChange={(e) => change({ ...content, schema: e.target.value })}
                />
              </Label>
              <p className="text-xs">
                Extension data is JSON. Edit and apply it explicitly; invalid or unapplied data is
                not saved.
              </p>
              {jsonEdit ? (
                <>
                  <Textarea
                    aria-label="Structured JSON data"
                    value={jsonEdit.text}
                    onChange={(e) => setJsonEdit({ ...jsonEdit, text: e.target.value })}
                  />
                  <p role="status" className="text-xs">
                    Unapplied JSON edits. Apply or discard them before saving, previewing, or
                    changing content language/type.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (JSON.stringify(content) !== JSON.stringify(jsonEdit.baseline)) {
                        setError(
                          "Content changed elsewhere. Copy your JSON before discarding these edits.",
                        );
                        return;
                      }
                      try {
                        const parsed = FragmentContentSchema.safeParse({
                          ...content,
                          data: JSON.parse(jsonEdit.text),
                        });
                        if (!parsed.success) throw new Error("Invalid JSON data");
                        change(parsed.data, true);
                        setJsonEdit(null);
                      } catch {
                        setError(
                          "Enter valid JSON before applying. Your entered text is kept and the saved data has not changed.",
                        );
                      }
                    }}
                  >
                    Apply JSON data
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setJsonEdit(null);
                      setError("");
                    }}
                  >
                    Discard JSON edits
                  </Button>
                </>
              ) : (
                <>
                  <pre className="overflow-auto text-xs">
                    {JSON.stringify(content.data, null, 2)}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setJsonEdit({
                        text: JSON.stringify(content.data, null, 2),
                        baseline: structuredClone(content),
                      })
                    }
                  >
                    Edit JSON data
                  </Button>
                </>
              )}
            </>
          ) : null}
          <details>
            <summary className="cursor-pointer text-xs">Change content type</summary>
            <p className="text-xs">
              Replacing this language's content does not convert it. Undo is available until you
              edit the replacement.
            </p>
            <NativeSelect
              aria-label="Replacement content type"
              value={nextType}
              disabled={pending}
              onChange={(e) => setNextType(e.target.value as FragmentContent["type"] | "")}
            >
              <option value="">Choose a type</option>
              {["text", "dialogue", "media", "structured"]
                .filter((t) => t !== content.type)
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </NativeSelect>
            {nextType === "media" && !options.length ? (
              <p className="text-xs">
                Add a context asset first. No asset reference will be invented.
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={!nextType || pending || (nextType === "media" && !options.length)}
              onClick={() => {
                const next: FragmentContent =
                  nextType === "dialogue"
                    ? { type: "dialogue", turns: [{ speaker: "{{user}}", text: "" }] }
                    : nextType === "media"
                      ? { type: "media", asset: options[0]?.ref ?? "" }
                      : nextType === "structured"
                        ? { type: "structured", schema: "", data: {} }
                        : { type: "text", text: "" };
                change(next, true);
                setNextType("");
              }}
            >
              Replace content
            </Button>
          </details>
        </>
      )}
      {undo ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (JSON.stringify(valueAt(fragment, undo.locale)) !== JSON.stringify(undo.after)) {
              setError(
                "This content changed after the action. Undo will not overwrite your newer edits.",
              );
              return;
            }
            if (undo.before) {
              const problem = targetError(working, undo.before.content);
              if (problem) {
                setError(problem);
                return;
              }
              if (
                undo.before.content.type === "dialogue" &&
                undo.before.content.turns.some((t) => t.speaker.startsWith("@")) &&
                JSON.stringify(working.references) !== JSON.stringify(undo.references)
              ) {
                setError("Dependencies changed. Restore them before undoing this dialogue.");
                return;
              }
            }
            onChange(replaceAt(fragment, undo.locale, undo.before));
            setLocale(undo.before ? undo.locale : "");
            setUndo(null);
            setError("");
          }}
        >
          Undo content change
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
