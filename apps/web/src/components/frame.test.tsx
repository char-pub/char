import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type GuestSession, type RegistryClient } from "@/lib/api";
import { noteApiError, noteWriteSucceeded } from "@/lib/read-only";
import { RegistryProvider } from "@/lib/registry";
import { setThemePreference } from "@/lib/theme";
import { fakeClient, ME } from "@/test/render";
import { Layout } from "./layout";
import { ThemeSegmented } from "./theme-toggle";

/** 用真实的 Layout 渲染一个带首页和探索页的小路由，便于检查顶栏的导航和搜索。 */
function renderFrame(client: RegistryClient, path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({
    component: () => (
      <Layout>
        <Outlet />
      </Layout>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <p>Home page</p>,
  });
  const browse = createRoute({
    getParentRoute: () => root,
    path: "/browse",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <p>Browse page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, browse]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RegistryProvider client={client}>
        <RouterProvider router={router} />
      </RegistryProvider>
    </QueryClientProvider>,
  );
  return router;
}

const signedOut = () => fakeClient({ me: async () => null, guestMe: async () => null });

const GUEST: GuestSession = {
  guest: {
    id: "gst_01j00000000000000000000000",
    display_name: "Wren",
    verified_at: "2026-09-22T12:00:00.000Z",
  },
  session_expires_at: "2026-10-22T12:00:00.000Z",
};

afterEach(() => {
  act(() => noteWriteSucceeded());
  setThemePreference("system");
  vi.unstubAllGlobals();
});

describe("site header", () => {
  it("links the main sections and the footer to the policy page and the specs", async () => {
    renderFrame(signedOut());
    const main = (await screen.findAllByRole("navigation", { name: "Main" }))[0];
    if (!main) throw new Error("missing main navigation");
    expect(within(main).getByRole("link", { name: "Explore" }).getAttribute("href")).toBe(
      "/browse",
    );
    expect(within(main).getByRole("link", { name: "Create" })).toBeTruthy();
    expect(within(main).getByRole("link", { name: "Playground" })).toBeTruthy();

    const footer = screen.getByRole("navigation", { name: "Footer" });
    expect(within(footer).getByRole("link", { name: "Content policy" }).getAttribute("href")).toBe(
      "/policy",
    );
    expect(within(footer).getByRole("link", { name: "Report content" }).getAttribute("href")).toBe(
      "/policy#report",
    );
    expect(within(footer).getByRole("link", { name: "Context IR" }).getAttribute("href")).toBe(
      "https://github.com/char-pub/char/blob/main/spec/context-ir-v0.md",
    );
  });

  it("searches the registry from any page", async () => {
    const router = renderFrame(signedOut());
    await userEvent.type(await screen.findByLabelText("Search the registry"), "night city{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/browse"));
    expect(router.state.location.search).toEqual({ q: "night city" });
    expect(await screen.findByText("Browse page")).toBeTruthy();
  });

  it("opens the sign-in dialog with the three providers", async () => {
    renderFrame(signedOut());
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign in to char.pub" });
    for (const provider of ["GitHub", "Discord", "Google"]) {
      expect(
        within(dialog).getByRole("button", { name: `Continue with ${provider}` }),
      ).toBeTruthy();
    }
  });

  it("shows the account menu for a signed-in user", async () => {
    renderFrame(fakeClient({ me: async () => ME }));
    const trigger = await screen.findByRole("button", { name: "Account menu for Test Writer" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("@writer")).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "My creations" }).getAttribute("href")).toBe(
      "/me",
    );
    expect(within(menu).getByRole("menuitem", { name: "New creation" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "API tokens" }).getAttribute("href")).toBe(
      "/settings#tokens",
    );
    expect(within(menu).getByRole("menuitem", { name: "Theme: System" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("shows a verified guest in the header and lets them sign out", async () => {
    let guest: GuestSession | null = GUEST;
    const guestSignOut = vi.fn(async () => {
      guest = null;
    });
    renderFrame(fakeClient({ me: async () => null, guestMe: async () => guest, guestSignOut }));
    const tag = await screen.findByRole("button", { name: "Guest session: Wren" });
    tag.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out as guest" }));
    expect(guestSignOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Guest session/ })).toBeNull());
    // 访客仍然可以登录正式账号。
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("does not ask for a guest session when the user is signed in", async () => {
    const guestMe = vi.fn(async () => GUEST);
    renderFrame(fakeClient({ me: async () => ME, guestMe }));
    await screen.findByRole("button", { name: "Account menu for Test Writer" });
    expect(guestMe).not.toHaveBeenCalled();
  });
});

describe("global notices", () => {
  it("shows the read-only banner only for the site-wide read-only code", async () => {
    renderFrame(signedOut());
    await screen.findByText("Home page");
    act(() => noteApiError(new ApiError(503, "feature.disabled")));
    expect(screen.queryByText(/read-only for maintenance/)).toBeNull();
    act(() => noteApiError(new ApiError(503, "feature.read_only")));
    expect(screen.getByText(/read-only for maintenance/)).toBeTruthy();
    // 之后任何一次写操作成功，说明只读已经解除。
    act(() => noteWriteSucceeded());
    expect(screen.queryByText(/read-only for maintenance/)).toBeNull();
  });

  it("explains a failed sign-in and can be dismissed", async () => {
    const router = renderFrame(signedOut(), "/?signin_error=1");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Sign-in did not complete");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("dialog", { name: "Sign in to char.pub" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(router.state.location.search).toEqual({});
  });
});

/** 内存里的 localStorage：测试环境的 Node 自带一个未配置的 localStorage，读写都不可用。 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe("theme", () => {
  it("switches between light, dark and system and remembers the choice", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    render(<ThemeSegmented />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    await userEvent.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("charpub.theme")).toBe("dark");

    await userEvent.click(within(group).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("charpub.theme")).toBe("light");

    // 跟随系统时不保存选择，首屏脚本按系统偏好决定。
    await userEvent.click(within(group).getByRole("radio", { name: "System" }));
    expect(window.localStorage.getItem("charpub.theme")).toBeNull();
  });
});
