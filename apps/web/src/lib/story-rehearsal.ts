/** Local author rehearsal over a built artifact. No draft mutation or model request occurs. */
import type { ContentArtifact } from "@char-pub/assembler";
import {
  initStoryState,
  type Story,
  type StoryCondition,
  type StoryJudgment,
  type StoryState,
  validateStoryState,
} from "@char-pub/core";

export interface StoryRehearsal {
  state: StoryState;
  /** Opening admission is fixed; later manual answers evaluate the current turn only. */
  openingJudgments: StoryJudgment[];
}
export interface JudgePrompt {
  target: string;
  path: string;
  question: string | Record<string, string>;
}
export function storyJudgePrompts(story: Story): JudgePrompt[] {
  const prompts: JudgePrompt[] = [];
  const walk = (condition: StoryCondition | undefined, target: string, path: string) => {
    if (!condition) return;
    if ("judge" in condition) prompts.push({ target, path, question: condition.judge });
    else if ("all" in condition || "any" in condition) {
      const key = "all" in condition ? "all" : "any";
      const children = "all" in condition ? condition.all : condition.any;
      children.forEach((child, i) => {
        walk(child, target, `${path}/${key}/${i}`);
      });
    } else if ("not" in condition) walk(condition.not, target, `${path}/not`);
  };
  for (const [kind, objects] of [
    ["scene", story.scenes],
    ["beat", story.beats ?? []],
    ["ending", story.endings ?? []],
    ["choice", story.choices ?? []],
    ["event", (story.events ?? []).filter((e) => e.kind === "planned")],
  ] as const)
    for (const object of objects) walk(object.when, `${kind}/${object.id}`, "/when");
  return prompts;
}
export function rehearsalState(
  artifact: ContentArtifact,
  start: string | undefined,
  judgments: StoryJudgment[],
  saved?: StoryRehearsal,
): StoryState {
  if (!artifact.story || !artifact.story_refs) throw new Error("This artifact has no Story.");
  const cast = Object.keys(artifact.story_refs.participants);
  if (saved) {
    validateStoryState(artifact.story, cast, saved.state);
    return saved.state;
  }
  return initStoryState(artifact.story, cast, start, judgments);
}
