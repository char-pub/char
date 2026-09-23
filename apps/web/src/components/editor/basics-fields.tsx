/**
 * 编辑器的第一层 “The basics”：头像、名字、地址（只读）、正文、简介，角色另有问候语。只填这些
 * 就可以发布。每个字段下面一句话说明它去了哪里：正文每次都会发给模型，简介只在卡片和搜索
 * 结果里显示。
 */
import type { CheckDiagnostic, CreationType } from "@char-pub/core";
import { type ReactNode, useId } from "react";
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
import { cn } from "@/lib/utils";
import { ANCHOR } from "./anchors";
import { AvatarField } from "./avatar-field";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";

export const MAIN_LABEL: Partial<
  Record<CreationType, { label: string; placeholder: string; help: string }>
> = {
  character: {
    label: "Description",
    placeholder: "Who they are: looks, personality, how they talk. Use {{self}} for the character.",
    help: "Always sent to the model. This is who the character is.",
  },
  world: {
    label: "About this world",
    placeholder: "The place, its rules and its history.",
    help: "Always sent to the model. Every character who lives here shares it.",
  },
  lorebook: {
    label: "First entry",
    placeholder: "A piece of lore. Add entries that switch on with keywords under Passages.",
    help: "Always sent to the model. Keyword entries go under More options → Passages.",
  },
};

export const SUMMARY_MAX = 500;

function Help({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-text-3">
      {children}
    </p>
  );
}

export function BasicsFields({
  ns,
  name: slug,
  type,
  working,
  update,
  diagnostics,
  latestLabel,
}: {
  ns: string;
  name: string;
  type: CreationType;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
  /** 最新 public 版本：用来找已发布的头像预览。 */
  latestLabel?: string | undefined;
}) {
  const ids = {
    name: useId(),
    address: useId(),
    main: useId(),
    summary: useId(),
    greeting: useId(),
  };
  const name = getName(working);
  const main = MAIN_FRAGMENT[type];
  const mainLabel = MAIN_LABEL[type];
  const summary = getSummary(working);
  const mainDiagnostics = diagnostics.filter(
    (d) => d.subject === "fragments" || (main && d.subject.startsWith(`fragments[${main.id}]`)),
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-[6.5rem_1fr]">
        <div id={ANCHOR.avatar} className="space-y-2">
          <AvatarField
            ns={ns}
            name={slug}
            working={working}
            update={update}
            latestLabel={latestLabel}
          />
          <DiagnosticList items={diagnosticsFor(diagnostics, "assets")} />
        </div>
        <div className="min-w-0 space-y-4">
          <div id={ANCHOR.name} className="space-y-1.5">
            <label htmlFor={ids.name} className="text-sm font-medium">
              Name
            </label>
            <Input
              id={ids.name}
              value={name}
              maxLength={200}
              aria-invalid={name.trim() === ""}
              onChange={(e) => update((w) => setName(w, e.target.value))}
            />
            {name.trim() === "" ? (
              <p className="text-xs text-danger">A name is required.</p>
            ) : (
              <Help>Shown as the title everywhere. Any language.</Help>
            )}
            <DiagnosticList items={diagnosticsFor(diagnostics, "display_name")} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={ids.address} className="text-sm font-medium">
              Address
            </label>
            <Input
              id={ids.address}
              readOnly
              value={`@${ns}/${slug}`}
              className="bg-surface-2 font-mono text-text-2"
            />
            <Help>
              The address stays the same. If you rename your @name, old links keep working.
            </Help>
          </div>
        </div>
      </div>

      {main && mainLabel ? (
        <div id={ANCHOR.main} className="space-y-1.5">
          <label htmlFor={ids.main} className="text-sm font-medium">
            {mainLabel.label}
          </label>
          <Textarea
            id={ids.main}
            rows={6}
            value={getMainText(working, type)}
            placeholder={mainLabel.placeholder}
            onChange={(e) => update((w) => setMainText(w, type, e.target.value))}
          />
          <Help>{mainLabel.help}</Help>
          <DiagnosticList items={mainDiagnostics} />
        </div>
      ) : null}

      <div id={ANCHOR.summary} className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={ids.summary} className="text-sm font-medium">
            Summary
          </label>
          <span
            className={cn(
              "font-mono text-xs",
              summary.length >= SUMMARY_MAX ? "text-warning" : "text-text-3",
            )}
          >
            {summary.length} / {SUMMARY_MAX}
          </span>
        </div>
        <Textarea
          id={ids.summary}
          rows={2}
          maxLength={SUMMARY_MAX}
          value={summary}
          placeholder="One or two sentences for cards and search results."
          onChange={(e) => update((w) => setSummary(w, e.target.value))}
        />
        <Help>Shown on cards and search results. Not sent to the model.</Help>
        <DiagnosticList items={diagnosticsFor(diagnostics, "summary")} />
      </div>

      {type === "character" ? (
        <div id={ANCHOR.greeting} className="space-y-1.5">
          <label htmlFor={ids.greeting} className="text-sm font-medium">
            Greeting
          </label>
          <Textarea
            id={ids.greeting}
            rows={4}
            value={getGreeting(working)}
            placeholder="The first thing your character says."
            onChange={(e) => update((w) => setGreeting(w, e.target.value))}
          />
          <Help>
            The first message. Use <span className="font-mono">{"{{user}}"}</span> for the reader's
            name.
          </Help>
          <DiagnosticList items={diagnosticsFor(diagnostics, "bootstrap")} />
        </div>
      ) : null}
    </div>
  );
}
