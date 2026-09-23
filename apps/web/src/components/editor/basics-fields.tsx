/**
 * 编辑器的第一层（Level 0）：名字、简介、问候语、头像。只填这些就可以发布一个角色。
 */
import type { CheckDiagnostic, CreationType } from "@char-pub/core";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getGreeting,
  getMainText,
  getName,
  getSummary,
  MAIN_FRAGMENT,
  setGreeting,
  setMainText,
  setName,
  setSummary,
  type Working,
} from "@/lib/draft";
import { AvatarField } from "./avatar-field";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";

const MAIN_LABEL: Partial<Record<CreationType, { label: string; placeholder: string }>> = {
  character: {
    label: "Description",
    placeholder: "Who they are: looks, personality, how they talk. Use {{self}} for the character.",
  },
  world: { label: "About this world", placeholder: "The place, its rules and its history." },
  lorebook: {
    label: "First entry",
    placeholder: "A piece of lore. Add more entries, with keywords, under More options.",
  },
};

export function BasicsFields({
  type,
  working,
  update,
  diagnostics,
}: {
  type: CreationType;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const ids = { name: useId(), main: useId(), summary: useId(), greeting: useId() };
  const name = getName(working);
  const main = MAIN_FRAGMENT[type];
  const mainLabel = MAIN_LABEL[type];
  const mainDiagnostics = diagnostics.filter(
    (d) => d.subject === "fragments" || (main && d.subject.startsWith(`fragments[${main.id}]`)),
  );
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <label htmlFor={ids.name} className="text-sm">
          Name
        </label>
        <Input
          id={ids.name}
          value={name}
          maxLength={200}
          aria-invalid={name.trim() === ""}
          onChange={(e) => update((w) => setName(w, e.target.value))}
        />
        {name.trim() === "" ? <p className="text-xs text-seal">A name is required.</p> : null}
        <DiagnosticList items={diagnosticsFor(diagnostics, "display_name")} />
      </div>

      {main && mainLabel ? (
        <div className="space-y-1">
          <label htmlFor={ids.main} className="text-sm">
            {mainLabel.label}
          </label>
          <Textarea
            id={ids.main}
            rows={6}
            value={getMainText(working, type)}
            placeholder={mainLabel.placeholder}
            onChange={(e) => update((w) => setMainText(w, type, e.target.value))}
          />
          <DiagnosticList items={mainDiagnostics} />
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={ids.summary} className="text-sm">
          Summary
        </label>
        <Textarea
          id={ids.summary}
          rows={2}
          maxLength={500}
          value={getSummary(working)}
          placeholder="One or two sentences shown in search results."
          onChange={(e) => update((w) => setSummary(w, e.target.value))}
        />
        <DiagnosticList items={diagnosticsFor(diagnostics, "summary")} />
      </div>

      {type === "character" ? (
        <div className="space-y-1">
          <label htmlFor={ids.greeting} className="text-sm">
            Greeting
          </label>
          <Textarea
            id={ids.greeting}
            rows={4}
            value={getGreeting(working)}
            placeholder="The first thing your character says. Use {{user}} for the person chatting."
            onChange={(e) => update((w) => setGreeting(w, e.target.value))}
          />
          <DiagnosticList items={diagnosticsFor(diagnostics, "bootstrap")} />
        </div>
      ) : null}

      <AvatarField working={working} update={update} />
      <DiagnosticList items={diagnosticsFor(diagnostics, "assets")} />
    </div>
  );
}
