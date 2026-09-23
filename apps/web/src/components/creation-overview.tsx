/**
 * Overview 标签的正文：开场白和作品自己的内容片段（不含依赖带来的内容）。片段显示类型、
 * 等宽的 id 和激活方式（Always、关键词、手动），正文按作者写的 Markdown 渲染。
 */
import type { ContextIR, IRFragment } from "@char-pub/core";
import { Hand, KeyRound, Pin, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserMarkdown, UserText } from "./user-content";

/** 先显示这么多段，其余的点“Show more”展开。 */
const FIRST_PASSAGES = 5;

/**
 * IR 里由会话决定的占位符写作 `{{late:user}}`；展示给读者时还原成作者写的 `{{user}}`。
 */
export function forDisplay(text: string): string {
  return text.replace(/\{\{late:user\}\}/g, "{{user}}");
}

const sectionLabel = "text-xs font-bold tracking-wider text-text-2 uppercase";

function Activation({ fragment }: { fragment: IRFragment }) {
  const a = fragment.activation;
  if (fragment.importance === "pinned" || a.mode === "always") {
    return (
      <Badge variant="neutral" className="font-medium">
        <Pin aria-hidden /> Always
      </Badge>
    );
  }
  if (a.mode === "keyword") {
    return (
      <Badge variant="blue" className="max-w-full font-medium whitespace-normal">
        <KeyRound aria-hidden />
        <span>
          keyword: <UserText text={a.keys.join(", ")} />
        </span>
      </Badge>
    );
  }
  if (a.mode === "manual") {
    return (
      <Badge variant="neutral" className="font-medium">
        <Hand aria-hidden /> By hand
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" className="font-medium">
      <Sparkles aria-hidden /> When relevant
    </Badge>
  );
}

function PassageBody({ fragment }: { fragment: IRFragment }) {
  const c = fragment.content;
  if (c.type === "text") return <UserMarkdown text={forDisplay(c.text)} />;
  if (c.type === "dialogue") {
    return (
      <ul className="space-y-1">
        {c.turns.map((t, i) => (
          // 对话轮次没有稳定 id，顺序就是身份。
          <li key={i}>
            <span className="font-mono text-xs text-text-3">{t.speaker}</span>{" "}
            <UserText text={forDisplay(t.text)} />
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-sm text-text-3">{c.type} content</p>;
}

export function CreationContent({ ir }: { ir: ContextIR }) {
  const own = ir.fragments.filter((f) => f.origin.creation === ir.root.ref);
  const greeting = ir.bootstrap.greetings[0];
  const [all, setAll] = useState(false);
  const shown = all ? own : own.slice(0, FIRST_PASSAGES);
  const hidden = own.length - shown.length;

  return (
    <div className="min-w-0 space-y-8">
      {greeting ? (
        <section aria-labelledby="c-greeting" className="space-y-3">
          <h2 id="c-greeting" className={sectionLabel}>
            Greeting
          </h2>
          <div className="rounded-lg bg-primary-soft px-5 py-4 text-text" data-greeting>
            <UserMarkdown text={forDisplay(greeting.text)} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="c-content" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="c-content" className={sectionLabel}>
            What it says{" "}
            <span className="font-medium normal-case tracking-normal text-text-3">
              · {own.length} {own.length === 1 ? "passage" : "passages"}
            </span>
          </h2>
          {own.length > 0 ? (
            <p className="text-xs text-text-3">Only its own text. Dependencies add more.</p>
          ) : null}
        </div>
        {own.length === 0 ? (
          <p className="rounded-lg border bg-surface px-5 py-4 text-sm text-text-2">
            This creation has no text of its own
            {greeting ? " besides the greeting" : ""}. What it brings comes from what it's built on.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-surface">
            {shown.map((f) => (
              <li key={f.id} className="space-y-2 px-5 py-4" data-fragment={f.origin.fragment}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold">{f.kind}</span>
                    <span className="font-mono text-xs break-all text-text-3">
                      #{f.origin.fragment}
                    </span>
                  </p>
                  <Activation fragment={f} />
                </div>
                <div className="text-sm text-text">
                  <PassageBody fragment={f} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 ? (
          <Button variant="link" onClick={() => setAll(true)}>
            Show {hidden} more {hidden === 1 ? "passage" : "passages"}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
