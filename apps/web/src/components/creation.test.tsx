import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { diffPair, resolveSample, samples } from "@/fixtures/samples";
import { ApiError, type Dependent } from "@/lib/api";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { BuiltOn, Credits, matureReason, UsedBy, WhyThisRating } from "./creation-facts";
import { CreationContent } from "./creation-overview";
import { ReportDialog } from "./report-dialog";
import { YankDialog } from "./yank-dialog";

const MATURE = resolveSample(diffPair.to).ir;

describe("Overview facts", () => {
  it("explains which dependency sets the effective rating", async () => {
    renderWithApp(<WhyThisRating ir={MATURE} name="Alice" />);
    const card = await screen.findByRole("region", { name: "Why this rating" });
    expect(card.textContent).toContain(
      "Mature, because a dependency is rated Mature. Alice on its own is General.",
    );
    const decisive = within(card).getByText("sets the rating").closest("li");
    expect(decisive?.textContent).toContain("@cyberpunk/night-city");
    expect(decisive?.textContent).toContain("World · Core");
    expect(matureReason(MATURE)).toBe("Rated Mature because of @cyberpunk/night-city (World).");
  });

  it("lists what it is built on with the relationship, the mode and the locked version", async () => {
    const ir = MATURE;
    const night = ir.graph.nodes.find((n) => n.ref === "@cyberpunk/night-city");
    const labels = new Map(night ? [[night.release, "2.0.0"]] : []);
    renderWithApp(<BuiltOn ir={ir} labels={labels} />);
    const card = await screen.findByRole("region", { name: "Built on" });
    const items = within(card).getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("Knows about Corporations of Night City");
    expect(items[0]?.textContent).toContain("Recommended");
    // 查不到版本号时显示锁定的 Release ID。
    expect(items[0]?.textContent).toMatch(/locked to rel_/);
    expect(items[1]?.textContent).toContain("Lives in Night City");
    expect(items[1]?.textContent).toContain("@cyberpunk/night-city@2.0.0");
    expect(items[1]?.textContent).toContain("Core");
  });

  it("says honestly when only the first page of dependents is shown", async () => {
    const one: Dependent = {
      ref: "@other/heist",
      type: "character",
      display_name: "The Heist",
      release: { id: "rel_01j00000000000000000000009", label: "0.3.0" },
      mode: "default",
    };
    const items = Array.from({ length: 7 }, (_, i) => ({ ...one, ref: `@other/heist-${i}` }));
    const onExpand = vi.fn();
    const { unmount } = renderWithApp(
      <UsedBy items={items} total={80} state="ready" expanded={false} onExpand={onExpand} />,
    );
    const card = await screen.findByRole("region", { name: "Used by · 80" });
    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(within(card).getByRole("button", { name: "See all 7" }));
    expect(onExpand).toHaveBeenCalled();
    unmount();

    renderWithApp(<UsedBy items={items} total={80} state="ready" expanded onExpand={onExpand} />);
    expect(await screen.findByText("Showing the first 7 of 80.")).toBeTruthy();
  });

  it("credits authors and licenses per creation", async () => {
    renderWithApp(<Credits ir={MATURE} />);
    const card = await screen.findByRole("region", { name: "Credits & licenses" });
    const rows = within(card).getAllByRole("listitem");
    const alice = rows.find(
      (r) => r.textContent?.includes("Author") && r.textContent?.includes("DJJ"),
    );
    expect(alice?.textContent).toContain("CC-BY-4.0");
    expect(card.textContent).toContain("CC-BY-NC-4.0");
  });
});

describe("CreationContent", () => {
  it("shows the greeting and its own passages with how each one activates", async () => {
    const world = samples.find((s) => s.id === "world-lore");
    if (!world) throw new Error("fixture missing");
    const ir = resolveSample(world).ir;
    renderWithApp(<CreationContent ir={ir} />);
    const greeting = await screen.findByRole("region", { name: "Greeting" });
    // `{{late:user}}` 还原成作者写的 `{{user}}`。
    expect(greeting.textContent).toContain("You're late again, {{user}}.");
    const passages = screen.getByRole("region", { name: /What it says/ });
    expect(passages.textContent).toContain("2 passages");
    expect(passages.textContent).toContain("#description");
    expect(within(passages).getAllByText("Always").length).toBeGreaterThan(0);
    // 依赖带来的内容不在这里。
    expect(passages.textContent).not.toContain("#lore/arasaka");
  });
});

describe("YankDialog", () => {
  it("requires a public reason and yanks the version", async () => {
    const yankRelease = vi.fn().mockResolvedValue({});
    const onOpenChange = vi.fn();
    renderWithApp(
      <YankDialog ns="djj" name="alice" label="1.2.0" open onOpenChange={onOpenChange} />,
      fakeClient({ yankRelease }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Yank 1.2.0?" });
    const submit = within(dialog).getByRole("button", { name: "Yank 1.2.0" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(dialog).getByLabelText("Reason (shown publicly)"), "no");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(dialog).getByLabelText("Reason (shown publicly)"), "t great ");
    await userEvent.click(submit);
    await waitFor(() =>
      expect(yankRelease).toHaveBeenCalledWith("djj", "alice", "1.2.0", "not great"),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("explains a refusal where it happened", async () => {
    const yankRelease = vi.fn().mockRejectedValue(new ApiError(403, "forbidden"));
    renderWithApp(
      <YankDialog ns="djj" name="alice" label="1.2.0" open onOpenChange={() => {}} />,
      fakeClient({ yankRelease }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Reason (shown publicly)"), "broken card");
    await userEvent.click(within(dialog).getByRole("button", { name: "Yank 1.2.0" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/can't yank/);
  });
});

describe("ReportDialog", () => {
  it("sends a signed-in report about one version and confirms it was received", async () => {
    const submitReport = vi.fn().mockResolvedValue({ status: "received" });
    renderWithApp(
      <ReportDialog ns="djj" name="alice" label="1.2.0" open onOpenChange={() => {}} />,
      fakeClient({ me: () => Promise.resolve(ME), submitReport }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Report @djj/alice" });
    const send = within(dialog).getByRole("button", { name: "Send report" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(dialog).getByLabelText("Only version 1.2.0"));
    await userEvent.click(within(dialog).getByLabelText("Copyright or trademark"));
    // 版权问题提示权利人走 DMCA 流程。
    expect(within(dialog).getByRole("link", { name: "copyright (DMCA) notice" })).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Details (optional)"), "It copies my art.");
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(send);
    await waitFor(() =>
      expect(submitReport).toHaveBeenCalledWith(
        "djj",
        "alice",
        { category: "copyright", details: "It copies my art.", turnstile_token: undefined },
        { label: "1.2.0" },
      ),
    );
    expect(await screen.findByText("Report received")).toBeTruthy();
  });

  it("asks anonymous visitors to sign in when the human check isn't configured", async () => {
    const submitReport = vi.fn();
    renderWithApp(
      <ReportDialog ns="djj" name="alice" label={undefined} open onOpenChange={() => {}} />,
      fakeClient({
        me: () => Promise.resolve(null),
        guestMe: () => Promise.resolve(null),
        submitReport,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Sign in to send a report.")).toBeTruthy();
    await userEvent.click(within(dialog).getByLabelText("Spam or malware"));
    const send = within(dialog).getByRole("button", { name: "Send report" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    // 没有版本时不提供“只举报这个版本”。
    expect(within(dialog).queryByText("What are you reporting?")).toBeNull();
  });

  it("shows the rate limit where the report failed", async () => {
    const submitReport = vi.fn().mockRejectedValue(new ApiError(429, "rate_limited"));
    renderWithApp(
      <ReportDialog ns="djj" name="alice" label="1.2.0" open onOpenChange={() => {}} />,
      fakeClient({ me: () => Promise.resolve(ME), submitReport }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("Wrong rating"));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Send report" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/Try again later/);
  });
});
