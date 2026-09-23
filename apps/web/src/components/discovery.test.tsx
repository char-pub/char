/**
 * 发现类页面：作品卡片、探索页、首页的最近发布、作者主页。页面用真实的路由表渲染
 * （含顶栏和页脚），Registry 客户端是假的，断言页面发出的搜索参数和显示的状态。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type CreationSummary, type RegistryClient, type SearchPage } from "@/lib/api";
import { RegistryProvider } from "@/lib/registry";
import { routeTree } from "@/routeTree.gen";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { CreationCard } from "./creation-card";

function item(n: number, over: Partial<CreationSummary> = {}): CreationSummary {
  return {
    id: `cr_01j000000000000000000000${String(n).padStart(2, "0")}`,
    ref: `@cyberpunk/item-${n}`,
    type: "character",
    display_name: `Item ${n}`,
    summary: `Summary ${n}.`,
    rating: "general",
    effective_rating: "general",
    tags: [],
    ...over,
  };
}

const page = (items: CreationSummary[], next: string | null = null): SearchPage => ({
  items,
  next_cursor: next,
});

async function renderPage(path: string, overrides: Partial<RegistryClient>) {
  const client = fakeClient({ me: async () => null, guestMe: async () => null, ...overrides });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RegistryProvider client={client}>
        <RouterProvider router={router} />
      </RegistryProvider>
    </QueryClientProvider>,
  );
  // 路由的首次加载是异步的：等页面框架出来再开始断言。
  await screen.findByRole("main");
  return router;
}

const main = () => within(screen.getByRole("main"));

describe("CreationCard", () => {
  it("links the creation and shows its ref, type, rating, tags and latest release", async () => {
    renderWithApp(
      <CreationCard
        item={item(1, {
          ref: "@djj/night-city",
          type: "world",
          display_name: { en: "Night City", zh: "夜之城" },
          effective_rating: "mature",
          tags: ["cyberpunk"],
          latest_release: {
            id: "rel_01j00000000000000000000000",
            label: "2.0.1",
            visibility: "public",
            status: "active",
            semantic_digest: `sha256:${"a".repeat(64)}`,
            effective_rating: "mature",
            created_at: "2026-09-22T12:00:00.000Z",
          },
        })}
      />,
    );
    const link = await screen.findByRole("link", { name: "Night City" });
    expect(link.getAttribute("href")).toBe("/c/djj/night-city");
    expect(screen.getByText("@djj/night-city")).toBeTruthy();
    expect(screen.getByText("World")).toBeTruthy();
    expect(screen.getByText("Mature")).toBeTruthy();
    expect(screen.getByRole("link", { name: "cyberpunk" }).getAttribute("href")).toBe(
      "/browse?tag=cyberpunk",
    );
    expect(screen.getByText("v2.0.1")).toBeTruthy();
  });

  it("shows a label that is not a version number as written", async () => {
    renderWithApp(
      <CreationCard
        item={item(1, {
          latest_release: {
            id: "rel_01j00000000000000000000000",
            label: "beta",
            visibility: "public",
            status: "active",
            semantic_digest: `sha256:${"a".repeat(64)}`,
            effective_rating: "general",
            created_at: "2026-09-22T12:00:00.000Z",
          },
        })}
      />,
    );
    expect(await screen.findByText("beta")).toBeTruthy();
  });
});

describe("Explore page", () => {
  it("searches with the filters in the address and loads more on request", async () => {
    const search = vi.fn(async (p: { cursor?: string | undefined }) =>
      p.cursor ? page([item(3)]) : page([item(1), item(2)], "o24"),
    );
    await renderPage("/browse?q=night&type=world&tag=cyberpunk", { search });
    expect(
      await main().findByText("Showing the first 2 results for “night” tagged “cyberpunk”"),
    ).toBeTruthy();
    expect(search).toHaveBeenCalledWith({
      q: "night",
      type: "world",
      tag: "cyberpunk",
      cursor: undefined,
      limit: 24,
    });
    expect(main().getByRole("button", { name: "Worlds", pressed: true })).toBeTruthy();
    expect(main().getByRole("button", { name: "Remove the tag filter “cyberpunk”" })).toBeTruthy();

    await userEvent.click(main().getByRole("button", { name: "Load more" }));
    expect(await main().findByText("3 results for “night” tagged “cyberpunk”")).toBeTruthy();
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "o24" }));
    expect(main().queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("switches the type and the tag from the page", async () => {
    const search = vi.fn(async () =>
      page([item(1, { tags: ["noir", "heist"] }), item(2, { tags: ["heist"] })]),
    );
    const router = await renderPage("/browse", { search });
    const tags = async () => within(await main().findByRole("group", { name: "Filter by tag" }));
    // 出现次数多的 tag 排在前面。
    expect((await tags()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "heist",
      "noir",
    ]);

    await userEvent.click(main().getByRole("button", { name: "Lorebooks" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ type: "lorebook" }));
    // 换了筛选条件后结果重新加载，tag 行也重新渲染。
    await userEvent.click(await (await tags()).findByRole("button", { name: "noir" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ type: "lorebook", tag: "noir" }),
    );
    await userEvent.click(
      await main().findByRole("button", { name: "Remove the tag filter “noir”" }),
    );
    await waitFor(() => expect(router.state.location.search).toEqual({ type: "lorebook" }));
  });

  it("explains an empty result and clears every filter", async () => {
    const router = await renderPage("/browse?q=zzz&type=world", { search: async () => page([]) });
    expect(await main().findByRole("heading", { name: "No results for “zzz”" })).toBeTruthy();
    expect(
      main().getByText(
        "Try using fewer words, removing the “Worlds” filter, or checking the spelling.",
      ),
    ).toBeTruthy();
    await userEvent.click(main().getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(
      (main().getByRole("searchbox", { name: "Search creations" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("keeps the filters when search fails and can retry", async () => {
    const search = vi.fn(async () => {
      throw new ApiError(500, "internal");
    });
    await renderPage("/browse?q=alice", { search });
    expect(
      await main().findByRole("heading", { name: "Search is unavailable right now" }),
    ).toBeTruthy();
    expect(main().getByText("internal")).toBeTruthy();
    await userEvent.click(main().getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  });

  it("tells visitors that signing in lets them turn mature content on", async () => {
    await renderPage("/browse", { search: async () => page([item(1)]) });
    expect(await main().findByText("Mature and explicit creations are hidden.")).toBeTruthy();
    expect(main().getByRole("button", { name: "Sign in to turn them on" })).toBeTruthy();
  });

  it("links signed-in users to their settings", async () => {
    await renderPage("/browse", { me: async () => ME, search: async () => page([item(1)]) });
    const link = await main().findByRole("link", { name: "Change in settings" });
    expect(link.getAttribute("href")).toBe("/settings");
  });
});

describe("Home page", () => {
  it("leads with the tagline and shows the most recent public releases", async () => {
    const search = vi.fn(async () => page([item(1), item(2)]));
    await renderPage("/", { search });
    expect(
      await main().findByRole("heading", {
        level: 1,
        name: /^Open characters\.\s*Shared worlds\.$/,
      }),
    ).toBeTruthy();
    expect(main().getByRole("link", { name: "Start creating" }).getAttribute("href")).toBe(
      "/create",
    );
    expect(main().getByRole("link", { name: "Explore the registry" }).getAttribute("href")).toBe(
      "/browse",
    );
    expect(
      main()
        .getByRole("link", { name: /Have a character card\?/ })
        .getAttribute("href"),
    ).toBe("/create/import");
    const recent = await main().findByRole("list", { name: "Recently published" });
    expect(within(recent).getAllByRole("article")).toHaveLength(2);
    // 不带关键词的搜索按发布时间倒序，取前 8 个。
    expect(search).toHaveBeenCalledWith({ limit: 8 });
  });

  it("offers a way to start when nothing is published yet", async () => {
    await renderPage("/", { search: async () => page([]) });
    expect(await main().findByRole("heading", { name: "Nothing published yet" })).toBeTruthy();
  });

  it("keeps the rest of the page when the registry does not answer", async () => {
    await renderPage("/", {
      search: async () => {
        throw new ApiError(500, "internal");
      },
    });
    expect(
      await main().findByRole("heading", { name: "Couldn't load recent creations" }),
    ).toBeTruthy();
    expect(main().getByRole("heading", { name: "Composition" })).toBeTruthy();
  });
});

describe("Author page", () => {
  const namespace = async (slug: string) => ({
    slug: slug === "old-name" ? "cyberpunk" : slug,
    kind: "user" as const,
    status: "active" as const,
  });

  it("lists every public creation with exact counts once all are loaded", async () => {
    const search = vi.fn(async () =>
      page([item(1), item(2, { type: "world" }), item(3, { type: "world" })]),
    );
    await renderPage("/c/cyberpunk", { namespace, search });
    expect(await main().findByRole("heading", { level: 1, name: "@cyberpunk" })).toBeTruthy();
    expect(await main().findByText("Personal namespace · 3 public creations")).toBeTruthy();
    const stats = within(main().getByRole("list", { name: "Creations by type" }));
    expect(stats.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1Character",
      "2Worlds",
    ]);
    const list = main().getByRole("list", { name: "Creations by @cyberpunk" });
    expect(within(list).getAllByRole("article")).toHaveLength(3);
    expect(search).toHaveBeenCalledWith({
      ns: "cyberpunk",
      type: undefined,
      cursor: undefined,
      limit: 24,
    });
    expect(main().getByRole("link", { name: "All creations" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("only says “more than” while more pages remain", async () => {
    await renderPage("/c/cyberpunk", {
      namespace,
      search: async () => page([item(1), item(2)], "o24"),
    });
    expect(
      await main().findByText("Personal namespace · More than 2 public creations"),
    ).toBeTruthy();
    expect(main().queryByRole("list", { name: "Creations by type" })).toBeNull();
    expect(main().getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("moves an old name to the current one and searches by the current name", async () => {
    const search = vi.fn(async (_p: { ns?: string | undefined }) => page([item(1)]));
    const router = await renderPage("/c/old-name", { namespace, search });
    await waitFor(() => expect(router.state.location.pathname).toBe("/c/cyberpunk"));
    expect(await main().findByRole("heading", { level: 1, name: "@cyberpunk" })).toBeTruthy();
    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search.mock.calls.every(([p]) => p.ns === "cyberpunk")).toBe(true);
  });

  it("filters by type on the server and keeps the counts from the full list", async () => {
    const search = vi.fn(async (p: { type?: string | undefined }) =>
      p.type === "world"
        ? page([item(2, { type: "world" })])
        : page([item(1), item(2, { type: "world" })]),
    );
    await renderPage("/c/cyberpunk?type=world", { namespace, search });
    const list = await main().findByRole("list", { name: "Creations by @cyberpunk" });
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ ns: "cyberpunk", type: "world" }),
    );
    expect(await main().findByText("Personal namespace · 2 public creations")).toBeTruthy();
    expect(main().getByRole("link", { name: "Worlds" }).getAttribute("aria-current")).toBe("page");
  });

  it("explains an empty type and links back to everything", async () => {
    await renderPage("/c/cyberpunk?type=lorebook", {
      namespace,
      search: async (p) => (p.type ? page([]) : page([item(1)])),
    });
    expect(
      await main().findByRole("heading", { name: "No lorebooks from @cyberpunk" }),
    ).toBeTruthy();
    expect(main().getByRole("link", { name: "Show all creations" }).getAttribute("href")).toBe(
      "/c/cyberpunk",
    );
  });

  it("shows the shared 404 for a namespace that does not exist", async () => {
    const search = vi.fn();
    await renderPage("/c/nobody", {
      namespace: async () => {
        throw new ApiError(404, "not_found");
      },
      search,
    });
    expect(await main().findByRole("heading", { name: "Nothing at @nobody" })).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });

  it("does not list creations of a suspended namespace", async () => {
    const search = vi.fn();
    await renderPage("/c/cyberpunk", {
      namespace: async () => ({ slug: "cyberpunk", kind: "org", status: "suspended" }),
      search,
    });
    expect(await main().findByRole("heading", { name: "@cyberpunk is suspended" })).toBeTruthy();
    expect(main().getByText("Organization")).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });
});
