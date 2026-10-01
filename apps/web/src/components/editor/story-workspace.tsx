import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Working } from "@/lib/draft";
import { storyOf } from "@/lib/story-editor";
import { type EditorNavigation, scrollToAnchor } from "./anchors";
import { StoryScenes } from "./story-scenes";
import { StoryStateEditor } from "./story-state";
import { StoryStructure } from "./story-structure";

const views = ["scenes", "plotlines", "timelines"] as const;
const labels = ["Scenes", "Plotlines", "Timelines"];
export function StoryWorkspace({
  working,
  update,
  navigation,
}: {
  navigation?: EditorNavigation | undefined;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
}) {
  const [view, setView] = useState<(typeof views)[number]>("scenes");
  const located = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (navigation?.request === located.current) return;
    if (!navigation?.storyView) return;
    if (view !== navigation.storyView) setView(navigation.storyView);
    else {
      located.current = navigation.request;
      scrollToAnchor(navigation.anchor);
    }
  }, [navigation, view]);
  const hasStory = !!storyOf(working);
  return (
    <section
      id="edit-story"
      aria-label="Story workspace"
      className="space-y-5 rounded-xl border bg-surface p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Story</h2>
        <Button
          variant="outline"
          disabled={!hasStory}
          onClick={() => scrollToAnchor("edit-story-state")}
        >
          Variables, items and knowledge
        </Button>
        <Button variant="outline" onClick={() => scrollToAnchor("edit-composition")}>
          Choose characters
        </Button>
      </div>
      <div role="tablist" aria-label="Story views" className="flex flex-wrap gap-2">
        {views.map((name, index) => (
          <Button
            key={name}
            role="tab"
            id={`story-tab-${name}`}
            aria-selected={view === name}
            aria-controls="story-view-panel"
            disabled={!hasStory && name !== "scenes"}
            tabIndex={view === name ? 0 : -1}
            variant={view === name ? "default" : "outline"}
            onClick={() => setView(name)}
            onKeyDown={(e) => {
              if (!hasStory || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              const name = views[next];
              if (!name) return;
              setView(name);
              document.getElementById(`story-tab-${name}`)?.focus();
            }}
          >
            {labels[index]}
          </Button>
        ))}
      </div>
      {!hasStory ? (
        <p className="text-sm text-text-2">
          Start with one scene. Plotlines and timelines become available once it exists.
        </p>
      ) : null}
      <div
        id="story-view-panel"
        role="tabpanel"
        aria-labelledby={`story-tab-${view}`}
        className="space-y-5"
      >
        <div hidden={view !== "scenes"}>
          <StoryScenes working={working} update={update} />
        </div>
        <StoryStructure working={working} update={update} view={view} />
      </div>
      {hasStory ? (
        <div id="edit-story-state">
          <StoryStateEditor working={working} update={update} />
        </div>
      ) : null}
    </section>
  );
}
