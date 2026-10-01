import type { ContentArtifact } from "@char-pub/assembler";
import {
  availableChoices,
  availableTargets,
  confirm,
  enterScene,
  evaluateCondition,
  type StoryCondition,
  type StoryState,
  setPresent,
  validateStoryState,
} from "@char-pub/core";
import { useState } from "react";
import { StoryValueEditor } from "@/components/editor/story-rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type PreviewSettings, previewFailure } from "@/lib/preview";
import { rehearsalState, storyJudgePrompts } from "@/lib/story-rehearsal";
import { localized } from "@/lib/text";

export function StoryRehearsalPanel({
  artifact,
  settings,
  onChange,
}: {
  artifact: ContentArtifact;
  settings: PreviewSettings;
  onChange: (s: PreviewSettings) => void;
}) {
  const [actionError, setActionError] = useState("");
  const story = artifact.story;
  if (!story || !artifact.story_refs) return null;
  const cast = Object.keys(artifact.story_refs.participants);
  const judgments = settings.judgments ?? [];
  let state: StoryState | undefined;
  let error = "";
  try {
    state = rehearsalState(artifact, settings.start, judgments, settings.rehearsal);
  } catch (e) {
    error = previewFailure(e).detail;
  }
  const run = (operation: (state: StoryState) => StoryState) => {
    if (!state) return;
    try {
      const next = operation(state);
      setActionError("");
      onChange({
        ...settings,
        rehearsal: {
          state: next,
          openingJudgments: settings.rehearsal?.openingJudgments ?? structuredClone(judgments),
        },
      });
    } catch (e) {
      setActionError(previewFailure(e).detail);
    }
  };
  const rows: {
    target: string;
    title: string;
    when?: StoryCondition | undefined;
    reached: boolean;
  }[] = [
    ...story.scenes.map((s) => ({
      target: `scene/${s.id}`,
      title: localized(s.title, settings.locale) || s.id,
      when: s.when,
      reached: false,
    })),
    ...(story.beats ?? []).map((s) => ({
      target: `beat/${s.id}`,
      title: localized(s.title, settings.locale) || s.id,
      when: s.when,
      reached: state?.reached.includes(s.id) ?? false,
    })),
    ...(story.events ?? [])
      .filter((e) => e.kind === "planned")
      .map((s) => ({
        target: `event/${s.id}`,
        title: localized(s.title, settings.locale) || s.id,
        when: s.when,
        reached: state?.happened.includes(s.id) ?? false,
      })),
    ...(story.endings ?? []).map((s) => ({
      target: `ending/${s.id}`,
      title: localized(s.title, settings.locale) || s.id,
      when: s.when,
      reached: state?.ended.includes(s.id) ?? false,
    })),
  ];
  const available = state ? availableTargets(story, cast, state, judgments) : [];
  const choices = state ? availableChoices(story, cast, state, judgments) : [];
  return (
    <details className="rounded border p-3" open={!!settings.rehearsal}>
      <summary className="cursor-pointer font-semibold">Check story logic</summary>
      <div className="mt-3 space-y-4 text-sm">
        <p className="text-xs text-text-2">
          Rehearse changes with fixed answers. This changes only your local preview; it makes no
          model calls and does not edit the story.
        </p>
        {settings.turn ? (
          <p role="status">
            A supplied snapshot is active. Open a fresh preview to rehearse this story.
          </p>
        ) : (
          <>
            {storyJudgePrompts(story).map((prompt) => {
              const key = `${prompt.target}${prompt.path}`;
              return (
                <Label key={key} className="block space-y-1">
                  {localized(prompt.question, settings.locale)}{" "}
                  <span className="text-xs text-text-3">{prompt.target}</span>
                  <NativeSelect
                    aria-label={`Judge ${key}`}
                    value={
                      judgments.find((j) => j.target === prompt.target && j.path === prompt.path)
                        ?.result ?? "undetermined"
                    }
                    onChange={(e) => {
                      const result = e.target.value as "true" | "false" | "undetermined";
                      setActionError("");
                      onChange({
                        ...settings,
                        judgments: [
                          ...judgments.filter(
                            (j) => j.target !== prompt.target || j.path !== prompt.path,
                          ),
                          {
                            target: prompt.target,
                            path: prompt.path,
                            result,
                            provider: { name: "manual", version: "web-story-preview-v1" },
                          },
                        ],
                      });
                    }}
                  >
                    <option value="undetermined">Undetermined</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </NativeSelect>
                </Label>
              );
            })}
            {error ? <p role="alert">Cannot enter the opening yet: {error}</p> : null}
            {actionError ? <p role="alert">{actionError}</p> : null}
            {state ? (
              <>
                <p role="status">
                  Current scene: {state.scene}
                  {state.stopped ? " · Story stopped" : ""}
                </p>
                <dl aria-label="Preview variables" className="space-y-1">
                  {Object.entries(state.vars).map(([key, value]) => (
                    <div key={key} className="flex flex-wrap justify-between gap-2">
                      <dt>{key}</dt>
                      <dd>{Array.isArray(value) ? value.join(", ") || "Empty" : String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <details>
                  <summary>Set preview variables</summary>
                  <p className="my-2 text-xs text-text-2">
                    Try a different state without changing the authored initial values.
                  </p>
                  <fieldset disabled={state.stopped} className="space-y-3">
                    {Object.entries(story.vars ?? {}).map(([key, variable]) => {
                      const value = state.vars[key];
                      if (value === undefined) return null;
                      return (
                        <StoryValueEditor
                          key={key}
                          working={{ story }}
                          variable={variable}
                          value={value}
                          label={`Preview variable ${key}`}
                          change={(value) =>
                            run((current) => {
                              const next = { ...current, vars: { ...current.vars, [key]: value } };
                              validateStoryState(story, cast, next);
                              return next;
                            })
                          }
                        />
                      );
                    })}
                  </fieldset>
                </details>
                <details>
                  <summary>Who knows what now</summary>
                  <dl>
                    {Object.entries(state.knowing).map(([info, who]) => (
                      <div key={info}>
                        <dt className="font-mono text-xs">{info}</dt>
                        <dd>{who.join(", ") || "No one"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <fieldset>
                  <legend className="font-medium">Present in this preview</legend>
                  {cast.map((key) => (
                    <Label key={key} className="my-1 flex gap-2">
                      <input
                        type="checkbox"
                        checked={state?.present.includes(key) ?? false}
                        disabled={state?.stopped}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          run((current) =>
                            setPresent(
                              story,
                              cast,
                              current,
                              checked
                                ? [...current.present, key]
                                : current.present.filter((k) => k !== key),
                            ),
                          );
                        }}
                      />
                      {key}
                    </Label>
                  ))}
                </fieldset>
                <ul aria-label="Story condition results" className="space-y-3">
                  {rows.map((row) => {
                    const truth = row.when
                      ? evaluateCondition(story, cast, state, row.when, judgments, row.target)
                      : true;
                    return (
                      <li key={row.target} className="space-y-1 rounded border p-2">
                        <p>
                          {row.title} ·{" "}
                          {truth === "unknown"
                            ? "Undetermined"
                            : truth
                              ? "Condition true"
                              : "Condition false"}
                          {row.reached ? " · Already reached" : ""}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!available.includes(row.target)}
                          onClick={() =>
                            run((current) =>
                              row.target.startsWith("scene/")
                                ? enterScene(story, cast, current, row.target.slice(6), judgments)
                                : confirm(story, cast, current, row.target, judgments),
                            )
                          }
                        >
                          {row.target.startsWith("scene/") ? "Enter" : "Confirm"} {row.title}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <p>
                  Available suggestions:{" "}
                  {choices
                    .map(
                      (id) =>
                        localized(
                          story.choices?.find((c) => c.id === id)?.label,
                          settings.locale,
                        ) || id,
                    )
                    .join(", ") || "None"}
                  . Suggestions do not apply effects.
                </p>
              </>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                const { rehearsal: _r, judgments: _j, ...rest } = settings;
                setActionError("");
                onChange(rest);
              }}
            >
              Reset rehearsal
            </Button>
          </>
        )}
      </div>
    </details>
  );
}
