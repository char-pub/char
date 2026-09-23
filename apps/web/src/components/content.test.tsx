import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatureGate } from "./mature-gate";
import { UserMarkdown, UserText } from "./user-content";

/** vitest 的 jsdom 里 storage 不可用，按需换成内存实现。 */
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

describe("MatureGate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides mature content until the user confirms, and says where the rating comes from", async () => {
    render(
      <MatureGate rating="mature" reason="Rated Mature because of @vee/afterlife (World).">
        <p>secret scene</p>
      </MatureGate>,
    );
    expect(screen.queryByText("secret scene")).toBeNull();
    expect(screen.getByText("Mature content is hidden")).toBeTruthy();
    expect(screen.getByText("Rated Mature because of @vee/afterlife (World).")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show this once" }));
    expect(screen.getByText("secret scene")).toBeTruthy();
  });

  it("shows general and teen content directly, and respects the account setting", () => {
    const { rerender } = render(
      <MatureGate rating="teen">
        <p>teen scene</p>
      </MatureGate>,
    );
    expect(screen.getByText("teen scene")).toBeTruthy();
    rerender(
      <MatureGate rating="explicit" allowed>
        <p>allowed scene</p>
      </MatureGate>,
    );
    expect(screen.getByText("allowed scene")).toBeTruthy();
  });

  it("remembers “Show this once” for the same creation for the rest of the session", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    const first = render(
      <MatureGate rating="explicit" remember="@djj/alice">
        <p>overview text</p>
      </MatureGate>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show this once" }));
    first.unmount();

    // 换到同一个作品的另一个标签页（组件重新挂载）：不再遮挡。
    render(
      <MatureGate rating="explicit" remember="@djj/alice">
        <p>preview table</p>
      </MatureGate>,
    );
    expect(screen.getByText("preview table")).toBeTruthy();

    // 别的作品仍然遮挡。
    render(
      <MatureGate rating="explicit" remember="@djj/other">
        <p>other creation</p>
      </MatureGate>,
    );
    expect(screen.queryByText("other creation")).toBeNull();
  });
});

describe("user content is never executed", () => {
  it("renders <script> in markdown as text, not as an element", () => {
    const { container } = render(
      <UserMarkdown
        text={'Hello <script>window.__pwned = 1</script> <img src=x onerror="alert(1)">'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("drops javascript: links", () => {
    const { container } = render(<UserMarkdown text="[click](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click");
  });

  it("keeps safe links with rel protections", () => {
    const { container } = render(<UserMarkdown text="[site](https://example.com)" />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });

  it("plain text shows markup literally", () => {
    const { container } = render(<UserText text="<script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });
});
