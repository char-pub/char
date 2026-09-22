/**
 * 作品页。现在用示例数据渲染；接上 Registry API 后改为按 `@ns/name` 读取。
 * 页面必须说明 effective rating 从哪里来，并列出依赖与署名。成人内容默认遮挡。
 */
import type { ContextIR } from "@char-pub/core";
import { MatureGate } from "./mature-gate";
import { RatingBadge, RatingSources } from "./rating";
import { UserMarkdown } from "./user-content";

export function CreationPage({ ir, summary }: { ir: ContextIR; summary?: string }) {
  const self = ir.graph.nodes.find((n) => n.ref === ir.root.ref);
  const deps = ir.graph.nodes.filter((n) => n.ref !== ir.root.ref);
  const own = ir.fragments.filter((f) => f.origin.creation === ir.root.ref);
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
          <section aria-labelledby="c-content" className="space-y-4">
            <h2 id="c-content" className="text-2xl">
              What it says
            </h2>
            {own.map((f) => (
              <div key={f.id} className="catalog-card p-4 pl-8" data-fragment={f.origin.fragment}>
                <p className="mb-1 font-mono text-xs text-muted-foreground">
                  #{f.origin.fragment} · {f.kind}
                </p>
                {f.content.type === "text" ? (
                  <UserMarkdown text={f.content.text} />
                ) : (
                  <p className="text-sm text-muted-foreground">{f.content.type} content</p>
                )}
              </div>
            ))}
          </section>
        </MatureGate>
      </div>

      <aside className="space-y-8">
        <section aria-labelledby="c-rating" className="space-y-2">
          <h2 id="c-rating" className="text-xl">
            Why this rating
          </h2>
          <RatingSources meta={ir.meta} />
        </section>
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
                  <span className="block">{d.display_name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.ref} · {d.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
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
                      : "Unknown author"}
                    {license ? ` · ${license.license}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </aside>
    </article>
  );
}
