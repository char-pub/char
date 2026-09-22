import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

const PILLARS = [
  {
    n: "01",
    title: "Open creation",
    body: "Write in the browser, import a character card, or publish from a GitHub repository. Every path ends in the same open format.",
  },
  {
    n: "02",
    title: "Composition",
    body: "Characters live in worlds, know lorebooks and share relationships — each pinned to an exact release, so nothing shifts under you.",
  },
  {
    n: "03",
    title: "Open context",
    body: "See exactly what reaches the model, and why. Download the context and run it in any runtime.",
  },
];

function Home() {
  return (
    <div className="space-y-16">
      <section className="grid gap-10 pt-6 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div className="reveal space-y-6">
          <p className="stamp border-seal text-seal">Registry · v0 preview</p>
          <h1 className="text-5xl leading-[1.02] sm:text-6xl">
            Characters, worlds and stories that{" "}
            <em className="font-display italic text-seal">no platform owns</em>.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            char.pub is an open registry and collaboration network for AI creations. Build on each
            other&apos;s work, lock the versions you depend on, and take your creations to any
            runtime.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/playground"
              className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
            >
              Open the context playground <ArrowRight aria-hidden className="size-4" />
            </Link>
            <Link
              to="/browse"
              className="inline-flex items-center gap-2 rounded-sm border border-foreground/70 px-4 py-2 hover:bg-muted"
            >
              Browse the catalog
            </Link>
          </div>
        </div>
        <aside className="catalog-card reveal reveal-2 p-6 pl-9 font-mono text-xs leading-6">
          <p className="text-muted-foreground">@djj/alice@1.1.0</p>
          <p>
            ├─ <span className="text-seal">lives_in</span> @cyberpunk/night-city
          </p>
          <p>
            └─ <span className="text-seal">knows_about</span> @cyberpunk/corps
          </p>
          <p className="mt-3 text-muted-foreground">lock · sha256:3f9a…c21e</p>
        </aside>
      </section>

      <section aria-label="What char.pub proves" className="grid gap-6 md:grid-cols-3">
        {PILLARS.map((p, i) => (
          <article
            key={p.n}
            className="catalog-card reveal p-6 pl-9"
            style={{ animationDelay: `${(i + 1) * 80}ms` }}
          >
            <p className="font-mono text-xs text-seal">{p.n}</p>
            <h2 className="mt-2 text-2xl">{p.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
