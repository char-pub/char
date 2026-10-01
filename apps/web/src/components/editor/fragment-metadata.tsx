import type { Fragment, SpeakerRef } from "@char-pub/core";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { localeOf, type Working } from "@/lib/draft";
import {
  type MetadataKey,
  type MetadataOption,
  metadataError,
  sourceError,
  sourceOptions,
  speakerError,
  speakerOptions,
} from "@/lib/fragment-metadata";
import { storyOf, storyText, withStoryText } from "@/lib/story-editor";
import { Field } from "./policy-editor";

function TargetPicker({
  label,
  value,
  options,
  error,
  change,
  external = false,
}: {
  label: string;
  value: string;
  options: MetadataOption[];
  error: (value: string) => string | null;
  change: (value: string) => void;
  external?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const known = options.some((option) => option.value === value);
  return (
    <div className="space-y-2">
      <NativeSelect aria-label={label} value={value} onChange={(e) => change(e.target.value)}>
        <option value="" disabled>
          Choose a target
        </option>
        {value && !known ? (
          <option value={value}>{value} (retained; build verifies target)</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {value && error(value) ? <p className="text-xs text-danger">{error(value)}</p> : null}
      {external ? (
        <details>
          <summary className="text-xs">Use an external reference</summary>
          <Field label={`${label} external reference`} value={draft} onChange={setDraft} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const problem = error(draft.trim());
              if (problem) {
                setNotice(problem);
                return;
              }
              change(draft.trim());
              setNotice("");
              setDraft("");
            }}
          >
            Apply {label.toLowerCase()} reference
          </Button>
          <p className="text-xs text-text-2">
            The draft build checks the exact dependency closure and participant identity.
          </p>
          {notice ? <p role="alert">{notice}</p> : null}
        </details>
      ) : null}
    </div>
  );
}

/** Edits only author metadata; dependency resolution and viewpoint filtering remain in the SDK. */
export function FragmentMetadata({
  working,
  fragment,
  onChange,
}: {
  working: Working;
  fragment: Fragment;
  onChange: (next: Fragment) => void;
}) {
  const locale = localeOf(working);
  const controlId = useId();
  const [undo, setUndo] = useState<{
    key: MetadataKey;
    before: Fragment[MetadataKey];
    after: Fragment[MetadataKey];
    references: unknown;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const edit = (key: MetadataKey, value: Fragment[MetadataKey], recover = false) => {
    const next = { ...fragment };
    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
    const problem = metadataError(working, next, key);
    if (problem) {
      setNotice(problem);
      return;
    }
    if (recover)
      setUndo({ key, before: fragment[key], after: value, references: working.references });
    setNotice("");
    onChange(next);
  };
  const restore = () => {
    if (!undo) return;
    if (JSON.stringify(fragment[undo.key]) !== JSON.stringify(undo.after)) {
      setNotice("This field changed after the action. Undo will not overwrite the newer edit.");
      return;
    }
    if (
      JSON.stringify(undo.before)?.includes("@") &&
      JSON.stringify(working.references) !== JSON.stringify(undo.references)
    ) {
      setNotice(
        "Dependencies changed. Restore the original references or add this metadata again and build to verify it.",
      );
      return;
    }
    const next = { ...fragment };
    if (undo.before === undefined) delete next[undo.key];
    else Object.assign(next, { [undo.key]: undo.before });
    const problem = metadataError(working, next, undo.key);
    if (problem) {
      setNotice(problem);
      return;
    }
    onChange(next);
    setUndo(null);
    setNotice("");
  };
  const perspective = fragment.perspective;
  const mode =
    typeof perspective === "object"
      ? "claim" in perspective
        ? "claim"
        : "belief"
      : (perspective ?? "canon");
  const speaker =
    typeof perspective === "object"
      ? "claim" in perspective
        ? perspective.claim
        : perspective.belief
      : "{{user}}";
  const visibility = fragment.visibility;
  const recipients = visibility?.scope === "private" ? visibility.to : [];
  const targets = speakerOptions(working);
  const sources = sourceOptions(working);
  const scenes = storyOf(working)?.scenes ?? [];
  const outwardAllowed = ["character", "persona", "examples"].includes(fragment.kind);
  return (
    <section aria-label="Passage metadata" className="space-y-3 border-t pt-3">
      <Field
        label={`Passage description (${locale})`}
        multiline
        value={storyText(fragment.description, locale)}
        onChange={(text) => {
          let next: Fragment["description"] = withStoryText(fragment.description, locale, text);
          if (!text.trim()) {
            if (typeof next === "object") {
              delete next[locale];
              if (!Object.keys(next).length) next = undefined;
            } else next = undefined;
          }
          if (
            next &&
            Object.values(typeof next === "string" ? { [locale]: next } : next).some(
              (value) => Array.from(value).length > 200,
            )
          ) {
            setNotice("Description must be at most 200 characters per language.");
            return;
          }
          edit("description", next);
        }}
      />
      <p className="text-xs text-text-2">
        A short description helps select relevant content before reading the passage. Up to 200
        characters per language; other translations are preserved.
      </p>
      {fragment.description ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={fragment.selectable === true}
          onClick={() => edit("description", undefined, true)}
        >
          Clear description in all languages
        </Button>
      ) : null}
      {fragment.activation?.mode === "keyword" || fragment.selectable !== undefined ? (
        <label htmlFor={`${controlId}-selectable`} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={`${controlId}-selectable`}
            aria-label="Allow AI selection without a keyword match"
            checked={fragment.selectable === true}
            disabled={
              !fragment.selectable &&
              (fragment.activation?.mode !== "keyword" || !fragment.description)
            }
            onCheckedChange={(checked) =>
              edit("selectable", checked === true ? true : undefined, true)
            }
          />
          Allow AI selection without a keyword match
        </label>
      ) : null}
      {fragment.activation?.mode === "keyword" && !fragment.description ? (
        <p className="text-xs">Add a description to enable AI selection.</p>
      ) : null}
      {fragment.selectable ? (
        <p className="text-xs">
          Turn off AI selection before removing the last description or changing activation mode.
        </p>
      ) : null}
      <label htmlFor={`${controlId}-perspective`} className="block text-sm">
        Perspective
        <NativeSelect
          id={`${controlId}-perspective`}
          aria-label="Passage perspective"
          value={mode}
          onChange={(e) => {
            const value = e.target.value;
            edit(
              "perspective",
              value === "canon"
                ? undefined
                : value === "rumor"
                  ? "rumor"
                  : value === "claim"
                    ? { claim: speaker }
                    : { belief: speaker },
              true,
            );
          }}
        >
          <option value="canon">Canon</option>
          <option value="rumor">Rumor</option>
          <option value="claim">Claim by a speaker</option>
          <option value="belief">Belief held by a speaker</option>
        </NativeSelect>
      </label>
      {mode === "claim" || mode === "belief" ? (
        <TargetPicker
          label="Perspective speaker"
          value={speaker}
          options={targets}
          error={(ref) => speakerError(working, ref)}
          external
          change={(value) =>
            edit(
              "perspective",
              mode === "claim" ? { claim: value as SpeakerRef } : { belief: value as SpeakerRef },
              true,
            )
          }
        />
      ) : null}
      <p className="text-xs text-text-2">
        Perspective marks whose claim or belief this is. It does not grant knowledge or make private
        content public.
      </p>
      <TargetPicker
        label="Passage source"
        value={fragment.source?.use ?? ""}
        options={sources}
        error={(ref) => sourceError(working, ref)}
        external
        change={(value) => edit("source", { use: value }, true)}
      />
      {!sources.length ? (
        <p className="text-xs">Upload a reference document to choose a local Source or section.</p>
      ) : null}
      {fragment.source ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => edit("source", undefined, true)}
        >
          Remove source attribution
        </Button>
      ) : null}
      <p className="text-xs text-text-2">
        Source attribution records provenance; it does not automatically insert the source body.
      </p>
      {fragment.selectable !== undefined && fragment.activation?.mode !== "keyword" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => edit("selectable", undefined, true)}
        >
          Remove unsupported selection setting
        </Button>
      ) : null}
      <details open={visibility !== undefined || fragment.outward !== undefined}>
        <summary className="text-sm">Advanced visibility</summary>
        <div className="space-y-3 pt-2">
          {outwardAllowed || fragment.outward !== undefined ? (
            <label htmlFor={`${controlId}-outward`} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`${controlId}-outward`}
                aria-label="Outward character information"
                checked={fragment.outward === true}
                disabled={!outwardAllowed && !fragment.outward}
                onCheckedChange={(checked) =>
                  edit("outward", checked === true ? true : undefined, true)
                }
              />
              Outward character information
            </label>
          ) : null}
          {outwardAllowed ? (
            <p className="text-xs">
              Other present participants may receive this passage. Private visibility and knowledge
              restrictions still apply.
            </p>
          ) : null}
          {fragment.outward !== undefined && !outwardAllowed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => edit("outward", undefined, true)}
            >
              Remove unsupported outward setting
            </Button>
          ) : null}

          <NativeSelect
            aria-label="Passage visibility"
            value={visibility?.scope ?? "shared"}
            onChange={(e) => {
              const scope = e.target.value;
              if (scope === "shared") edit("visibility", undefined, true);
              else if (scope === "private") edit("visibility", { scope, to: ["{{user}}"] }, true);
              else if (scope === "scene") edit("visibility", { scope }, true);
              else if (scope === "story-scene" && scenes[0])
                edit("visibility", { scope, scene: scenes[0].id }, true);
            }}
          >
            <option value="shared">Shared</option>
            <option value="private">Private recipients</option>
            <option value="scene">Reference instance / passage scene</option>
            <option value="story-scene" disabled={!scenes.length}>
              Story scene
            </option>
          </NativeSelect>
          <p className="text-xs text-text-2">
            Per-agent views enforce private recipients. Narrator views can include private facts.
            This is context visibility, not publishing access.
          </p>
          {visibility?.scope === "private" ? (
            <div className="space-y-2">
              {[
                ...targets,
                ...recipients
                  .filter((ref) => !targets.some((target) => target.value === ref))
                  .map((ref) => ({ value: ref, label: `${ref} (retained)` })),
              ].map((target) => (
                <label
                  key={target.value}
                  htmlFor={`${controlId}-${target.value}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`${controlId}-${target.value}`}
                    aria-label={`Private recipient ${target.value}`}
                    checked={recipients.includes(target.value)}
                    onCheckedChange={(checked) =>
                      edit(
                        "visibility",
                        {
                          scope: "private",
                          to:
                            checked === true
                              ? [...recipients, target.value]
                              : recipients.filter((ref) => ref !== target.value),
                        },
                        true,
                      )
                    }
                  />
                  {target.label}
                </label>
              ))}
              <TargetPicker
                label="Additional private recipient"
                value=""
                options={[]}
                external
                error={(ref) => speakerError(working, ref)}
                change={(ref) =>
                  edit(
                    "visibility",
                    { scope: "private", to: [...new Set([...recipients, ref])] },
                    true,
                  )
                }
              />
            </div>
          ) : null}
          {visibility?.scope === "scene" ? (
            <>
              <NativeSelect
                aria-label="Passage scene target"
                value={visibility.scene ?? ""}
                onChange={(e) =>
                  edit(
                    "visibility",
                    e.target.value ? { scope: "scene", scene: e.target.value } : { scope: "scene" },
                    true,
                  )
                }
              >
                <option value="">This reference instance</option>
                {visibility.scene && !working.fragments?.some((f) => f.id === visibility.scene) ? (
                  <option value={visibility.scene}>{visibility.scene} (missing)</option>
                ) : null}
                {working.fragments?.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs">
                The runtime must use this resolved instance or passage ID as its scene. For an
                authored Story scene, choose Story scene instead.
              </p>
            </>
          ) : null}
          {visibility?.scope === "story-scene" ? (
            <TargetPicker
              label="Story visibility scene"
              value={visibility.scene}
              options={scenes.map((scene) => ({
                value: scene.id,
                label: storyText(scene.title, locale) || scene.id,
              }))}
              error={(value) =>
                scenes.some((scene) => scene.id === value) ? null : "Missing Story scene"
              }
              change={(scene) => edit("visibility", { scope: "story-scene", scene }, true)}
            />
          ) : null}
          {metadataError(working, fragment, "visibility") ? (
            <p className="text-xs text-danger">{metadataError(working, fragment, "visibility")}</p>
          ) : null}
        </div>
      </details>
      {undo ? (
        <Button type="button" size="sm" variant="outline" onClick={restore}>
          Undo metadata change
        </Button>
      ) : null}
      {notice ? <p role="alert">{notice}</p> : null}
    </section>
  );
}
