/**
 * 作品页的组成部分：正文（作品自己的 fragment 与问候语）、依赖、署名与许可。
 * 它们都从 Context IR 读取，线上作品页与本地示例共用。页面必须说明 effective rating
 * 从哪里来，并列出依赖与署名；成人内容默认遮挡。
 */
import type { ContextIR } from "@char-pub/core";
import { MatureGate } from "./mature-gate";
import { RatingBadge, RatingSources } from "./rating";
import { UserMarkdown, UserText } from "./user-content";

/**
 * IR 里由会话决定的占位符写作 `{{late:user}}`；展示给读者时还原成作者写的 `{{user}}`。
 */
function forDisplay(text: string): string {
  return text.replace(/\{\{late:user\}\}/g, "{{user}}");
}

/** 作品自己的 fragment（不含依赖带来的内容）与默认问候语。 */
export function IRFragments({ ir }: { ir: ContextIR }) {
  const own = ir.fragments.filter((f) => f.origin.creation === ir.root.ref);
  const greeting = ir.bootstrap.greetings[0];
  return (
    <section aria-labelledby="c-content" className="space-y-4">
      <h2 id="c-content" className="text-2xl">
        What it says
      </h2>
      {greeting ? (
        <div className="catalog-card p-4 pl-8" data-greeting>
          <p className="mb-1 font-mono text-xs text-muted-foreground">greeting</p>
          <UserMarkdown text={forDisplay(greeting.text)} />
        </div>
      ) : null}
      {own.map((f) => (
        <div key={f.id} className="catalog-card p-4 pl-8" data-fragment={f.origin.fragment}>
          <p className="mb-1 font-mono text-xs text-muted-foreground">
            #{f.origin.fragment} · {f.kind}
            {f.activation.mode === "keyword" ? ` · when: ${f.activation.keys.join(", ")}` : ""}
          </p>
          {f.content.type === "text" ? (
            <UserMarkdown text={forDisplay(f.content.text)} />
          ) : (
            <p className="text-sm text-muted-foreground">{f.content.type} content</p>
          )}
        </div>
      ))}
      {own.length === 0 && !greeting ? (
        <p className="text-sm text-muted-foreground">This creation has no text of its own.</p>
      ) : null}
    </section>
  );
}

/** 依赖闭包中的其他 Creation，每一项都锁定到精确的 Release。 */
export function BuiltOn({ ir }: { ir: ContextIR }) {
  const deps = ir.graph.nodes.filter((n) => n.ref !== ir.root.ref);
  return (
    <section aria-labelledby="c-deps" className="space-y-2">
      <h2 id="c-deps" className="text-xl">
        Built on
      </h2>
      {deps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No dependencies.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {deps.map((d) => (
            <li key={d.ref} className="py-2 text-sm">
              <span className="block">
                <UserText text={d.display_name} />
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {d.ref} · {d.type}
              </span>
              <span className="block truncate font-mono text-[0.7rem] text-muted-foreground">
                locked to {d.release}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 没有写明作者时显示发布它的 namespace，例如 `@alice/luna` → `@alice`。 */
function publisherOf(ref: string): string {
  return ref.split("/")[0] ?? ref;
}

/** 署名、许可与贡献者。 */
export function Credits({ ir }: { ir: ContextIR }) {
  return (
    <section aria-labelledby="c-attr" className="space-y-2">
      <h2 id="c-attr" className="text-xl">
        Credits &amp; licenses
      </h2>
      <ul className="space-y-2 text-sm">
        {ir.meta.attribution.map((a) => {
          const license = ir.meta.licenses.find((l) => l.ref === a.ref && !l.asset);
          return (
            <li key={a.ref}>
              <span className="font-mono text-xs">{a.ref}</span>
              <span className="block text-muted-foreground">
                {a.authors.length > 0
                  ? a.authors.map((x) => x.name).join(", ")
                  : publisherOf(a.ref)}
                {license ? ` · ${license.license}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {ir.meta.contributors.length > 0 ? (
        <div className="space-y-1 pt-2">
          <h3 className="text-sm font-medium">Contributors</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {ir.meta.contributors.map((c) => (
              <li
                key={`${c.ref}:${typeof c.author === "string" ? c.author : c.author.guest_id}`}
                className="font-mono"
              >
                {typeof c.author === "string" ? c.author : c.author.display_name} → {c.ref}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ir.meta.import_omissions.length > 0 ? (
        <p className="pt-2 text-xs text-muted-foreground">
          Imported from a character card; these fields were left out:{" "}
          {ir.meta.import_omissions.flatMap((o) => o.fields).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}

/** 本地示例的作品页（没有 Registry 数据，只有 IR）。 */
export function CreationPage({ ir, summary }: { ir: ContextIR; summary?: string }) {
  const self = ir.graph.nodes.find((n) => n.ref === ir.root.ref);
  return (
    <article className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-sm text-muted-foreground">{ir.root.ref}</p>
          <h1 className="text-5xl">{self?.display_name ?? ir.root.ref}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <RatingBadge rating={ir.meta.rating} />
            {self ? <span className="stamp border-rule">{self.type}</span> : null}
            {ir.meta.content_warnings.map((w) => (
              <span key={w} className="stamp border-amber/60 bg-amber-soft">
                {w}
              </span>
            ))}
          </div>
          {summary ? <p className="max-w-prose text-lg text-muted-foreground">{summary}</p> : null}
        </header>
        <MatureGate rating={ir.meta.rating}>
          <IRFragments ir={ir} />
        </MatureGate>
      </div>

      <aside className="space-y-8">
        <section aria-labelledby="c-rating" className="space-y-2">
          <h2 id="c-rating" className="text-xl">
            Why this rating
          </h2>
          <RatingSources meta={ir.meta} />
        </section>
        <BuiltOn ir={ir} />
        <Credits ir={ir} />
      </aside>
    </article>
  );
}
