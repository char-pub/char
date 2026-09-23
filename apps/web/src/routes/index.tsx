import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Compass,
  FileUp,
  GitFork,
  Lock,
  PenLine,
  Plus,
  ScanEye,
  SquareTerminal,
} from "lucide-react";
import type * as React from "react";
import { TYPE_STYLE, TypeBadge } from "@/components/badges";
import { CreationAvatar } from "@/components/creation-card";
import { Container } from "@/components/layout";
import { SearchResults } from "@/components/search-results";
import { CardGridSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ staticData: { fullBleed: true }, component: Home });

/** 首页“最近发布”取几个。桌面正好两行四列。 */
const RECENT_COUNT = 8;
const CLI_DOCS = "https://github.com/char-pub/char/tree/main/packages/cli";

function Home() {
  return (
    <>
      <Hero />
      <Pillars />
      <RecentlyPublished />
      <WaysIn />
    </>
  );
}

function Hero() {
  return (
    <Container className="grid gap-12 py-12 md:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center">
      <div className="space-y-6">
        <p className="inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-xs font-medium text-text-2">
          <span aria-hidden className="flex gap-1">
            <span className="size-1.5 rounded-full bg-purple" />
            <span className="size-1.5 rounded-full bg-primary" />
            <span className="size-1.5 rounded-full bg-blue" />
          </span>
          Open registry · v0 preview
        </p>
        <h1 className="text-5xl leading-[1.02] font-extrabold tracking-[-0.03em] sm:text-6xl xl:text-[4rem]">
          <span className="block">Open characters.</span>
          <span className="block">Shared worlds.</span>
        </h1>
        <p className="max-w-xl text-lg text-pretty text-text-2">
          Publish AI characters, worlds and lorebooks in an open format. Build on each other&apos;s
          work, pin exact versions, and take them to any runtime — no single platform owns them.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link to="/create" className={buttonVariants({ size: "lg" })}>
            <Plus aria-hidden /> Start creating
          </Link>
          <Link to="/browse" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <Compass aria-hidden /> Explore the registry
          </Link>
        </div>
        <p>
          <Link
            to="/create/import"
            className="text-sm font-medium text-blue-text underline-offset-4 hover:underline"
          >
            Have a character card? Import PNG, JSON or CHARX{" "}
            <ArrowRight aria-hidden className="inline size-3.5" />
          </Link>
        </p>
      </div>
      <CompositionExample />
    </Container>
  );
}

/**
 * 示意卡：一个角色依赖一个 World 和一个 Lorebook，下面是各自在上下文里的 token 占比。
 * 数据是静态的示例，只用来说明“组合 + 上下文”，不链接到真实作品。颜色按作品类型取 `TYPE_STYLE`。
 */
const EXAMPLE = {
  name: "Alice",
  ref: "@djj/alice@1.2.0",
  deps: [
    { rel: "lives in", ref: "@cyberpunk/night-city@2.0.1", type: "world" },
    { rel: "knows about", ref: "@cyberpunk/corps@1.4.0", type: "lorebook" },
  ],
  context: [
    { label: "Alice", type: "character", tokens: 612 },
    { label: "Night City", type: "world", tokens: 438 },
    { label: "Corps", type: "lorebook", tokens: 234 },
  ],
  lock: "sha256:3f9a…c21e",
} as const;

function CompositionExample() {
  const total = EXAMPLE.context.reduce((n, s) => n + s.tokens, 0);
  return (
    <figure className="min-w-0 rounded-xl border bg-surface p-5 md:p-6">
      <figcaption className="sr-only">
        Example: a character that lives in a world and knows a lorebook, and how much of the context
        each one adds.
      </figcaption>
      <div className="flex items-start gap-3">
        <CreationAvatar name={EXAMPLE.name} type="character" />
        <div className="min-w-0 flex-1">
          <p className="text-lg leading-snug font-bold">{EXAMPLE.name}</p>
          <p className="font-mono text-xs break-all text-text-3">{EXAMPLE.ref}</p>
        </div>
        <TypeBadge type="character" />
      </div>

      <ul className="mt-4 ml-2 space-y-2 border-l border-border-strong pl-4">
        {EXAMPLE.deps.map((d) => (
          <li
            key={d.ref}
            className="relative flex flex-wrap items-center gap-x-2 text-sm before:absolute before:top-1/2 before:-left-4 before:w-3 before:border-t before:border-border-strong"
          >
            <span aria-hidden className={cn("size-2 rounded-full", TYPE_STYLE[d.type].dot)} />
            <span className="text-text-2">{d.rel}</span>
            <span className="font-mono text-xs break-all">{d.ref}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-lg bg-surface-2 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold">Context preview</p>
          <p className="font-mono text-xs text-text-3">
            {total.toLocaleString("en-US")} tokens · estimate
          </p>
        </div>
        <div aria-hidden className="mt-3 flex h-2 gap-1">
          {EXAMPLE.context.map((s) => (
            <span
              key={s.label}
              className={cn("min-w-1 rounded-full", TYPE_STYLE[s.type].dot)}
              style={{ flexGrow: s.tokens }}
            />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
          {EXAMPLE.context.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-xs", TYPE_STYLE[s.type].dot)} />
              {s.label} <span className="font-mono">{s.tokens}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 flex items-start gap-2 font-mono text-xs text-text-3">
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>lock {EXAMPLE.lock} · resolves the same everywhere</span>
      </p>
    </figure>
  );
}

const PILLARS: {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}[] = [
  {
    title: "Open creation",
    body: "Write in the browser, import a character card, or publish from GitHub. Every path ends in the same open format.",
    icon: PenLine,
    tone: "bg-primary-soft text-primary-text",
  },
  {
    title: "Composition",
    body: "Characters live in worlds and know lorebooks. Each link is pinned to an exact release, so nothing shifts under you.",
    icon: GitFork,
    tone: "bg-purple-soft text-purple-text",
  },
  {
    title: "Open context",
    body: "See exactly what reaches the model and why. Download the context and run it in any runtime.",
    icon: ScanEye,
    tone: "bg-blue-soft text-blue-text",
  },
];

function Pillars() {
  return (
    <Container className="pb-16 md:pb-20">
      <section aria-label="What char.pub is for" className="grid gap-4 md:grid-cols-3 md:gap-6">
        {PILLARS.map((p) => (
          <article key={p.title} className="rounded-xl border bg-surface p-6">
            <span
              aria-hidden
              className={cn("flex size-10 items-center justify-center rounded-md", p.tone)}
            >
              <p.icon className="size-5" />
            </span>
            <h2 className="mt-5 text-lg">{p.title}</h2>
            <p className="mt-2 text-sm text-pretty text-text-2">{p.body}</p>
          </article>
        ))}
      </section>
    </Container>
  );
}

/**
 * 最近发布：不带关键词的搜索按最新 public Release 的发布时间倒序返回，所以取前几个就是
 * “最近发布”。成人内容照常由服务端按账号设置过滤。
 */
function RecentlyPublished() {
  const client = useRegistry();
  const me = useMe();
  const recent = useQuery({
    queryKey: keys.search({ recent: true, limit: RECENT_COUNT, user: me.data?.id ?? null }),
    queryFn: () => client.search({ limit: RECENT_COUNT }),
    enabled: !me.isPending,
  });
  const showsMature = me.data?.settings.show_mature ?? false;
  return (
    <Container className="pb-16 md:pb-24">
      <section aria-labelledby="home-recent" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="space-y-1">
            <h2 id="home-recent" className="text-2xl">
              Recently published
            </h2>
            <p className="text-sm text-text-2">
              {showsMature
                ? "The latest releases on char.pub, including mature and explicit ones because you turned them on."
                : "Fresh releases from the registry. Mature and explicit creations stay hidden unless you turn them on."}
            </p>
          </div>
          <Link
            to="/browse"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-text underline-offset-4 hover:underline"
          >
            Explore all <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
        {recent.isPending ? (
          <CardGridSkeleton count={RECENT_COUNT} label="Loading recent creations…" />
        ) : recent.isError ? (
          <ErrorState
            title="Couldn't load recent creations"
            description="The registry didn't respond. Everything else on this page still works."
            error={recent.error}
            onRetry={() => void recent.refetch()}
          />
        ) : (
          <SearchResults
            items={recent.data.items}
            label="Recently published"
            // 窄屏只放前四个，其余的去探索页看。
            className="max-sm:[&>li:nth-child(n+5)]:hidden"
            empty={
              <EmptyState
                title="Nothing published yet"
                description="Be the first: write a character in the browser, or import a card you already have."
                action={
                  <Link to="/create" className={buttonVariants({ variant: "outline" })}>
                    <Plus aria-hidden /> Start creating
                  </Link>
                }
              />
            }
          />
        )}
      </section>
    </Container>
  );
}

const WAYS: {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  to?: "/create" | "/create/import";
  href?: string;
  code?: string;
}[] = [
  {
    title: "Write in the browser",
    body: "Name, description, greeting and an avatar are enough to publish a first character.",
    icon: PenLine,
    tone: "bg-primary text-on-primary",
    to: "/create",
  },
  {
    title: "Import a character card",
    body: "PNG, JSON or CHARX. See exactly what was mapped, what was dropped, and confirm the rest.",
    icon: FileUp,
    tone: "bg-purple text-white",
    to: "/create/import",
  },
  {
    title: "Publish from GitHub or the CLI",
    body: "Keep your source in a repository and publish releases from the command line.",
    icon: SquareTerminal,
    tone: "bg-blue text-white",
    href: CLI_DOCS,
    code: "$ char publish --label 1.2.0",
  },
];

/**
 * 三种入口的深色区块。浅色主题用 Ink 底；深色主题整页已经是深色，改用 surface 加上下边框，
 * 不反转成浅色的一大块。
 */
function WaysIn() {
  const rowClass =
    "group flex items-center gap-4 rounded-xl border border-on-ink/10 bg-on-ink/5 p-4 transition-colors hover:bg-on-ink/10 md:p-5 dark:border-border dark:bg-surface-2 dark:hover:bg-border";
  return (
    <section
      aria-labelledby="home-ways"
      className="bg-ink text-on-ink dark:border-y dark:bg-surface dark:text-text"
    >
      <Container className="grid gap-10 py-16 md:py-20 lg:grid-cols-[1fr_1.3fr] lg:items-center">
        <div className="space-y-4">
          <h2 id="home-ways" className="text-3xl text-balance md:text-4xl">
            Start from wherever your character lives today.
          </h2>
          <p className="max-w-md text-on-ink/70 dark:text-text-2">
            Three ways in, one open format out. You choose the rating, rights and license — nothing
            is assumed for you.
          </p>
        </div>
        <ul className="space-y-3">
          {WAYS.map((w) => {
            const content = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-md",
                    w.tone,
                  )}
                >
                  <w.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block font-semibold">{w.title}</span>
                  <span className="block text-sm text-on-ink/70 dark:text-text-2">{w.body}</span>
                  {w.code ? (
                    <code className="mt-2 inline-block rounded-sm bg-on-ink/10 px-2 py-1 font-mono text-xs break-all dark:bg-bg">
                      {w.code}
                    </code>
                  ) : null}
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5"
                />
              </>
            );
            return (
              <li key={w.title}>
                {w.to ? (
                  <Link to={w.to} className={rowClass}>
                    {content}
                  </Link>
                ) : (
                  <a href={w.href} className={rowClass}>
                    {content}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
