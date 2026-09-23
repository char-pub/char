import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { fakeClient, renderWithApp } from "@/test/render";
import { AddressField, useNameAvailability } from "./address-field";
import { missingText } from "./import-wizard";
import { NamespaceSetup } from "./namespace-setup";

describe("NamespaceSetup", () => {
  it.each([
    ["namespace.taken", "@commons is already taken. Try another name."],
    ["namespace.reserved", "@commons is reserved. Try another name."],
    [
      "namespace.limit",
      "Your account already has a personal @name. Reload the page to continue with it.",
    ],
  ])("explains %s", async (code, text) => {
    const createNamespace = vi.fn(async () => {
      throw new ApiError(409, code);
    });
    renderWithApp(<NamespaceSetup suggestion="Commons" />, fakeClient({ createNamespace }));
    const input = (await screen.findByLabelText("Namespace")) as HTMLInputElement;
    expect(input.value).toBe("commons");
    await userEvent.click(screen.getByRole("button", { name: "Register @commons" }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(createNamespace).toHaveBeenCalledWith("commons");
    // 改了名字之后旧的错误消失。
    await userEvent.type(input, "-2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says that the name can be changed later", async () => {
    renderWithApp(<NamespaceSetup suggestion="Rin" />);
    expect(await screen.findByText(/old links keep working/)).toBeTruthy();
  });
});

function AddressHarness({ initial }: { initial: string }) {
  const [slug, setSlug] = useState(initial);
  const availability = useNameAvailability("writer", slug);
  return (
    <>
      <label htmlFor="addr">Address</label>
      <AddressField
        id="addr"
        hintId="addr-hint"
        ns="writer"
        value={slug}
        availability={availability}
        onChange={setSlug}
      />
    </>
  );
}

describe("AddressField", () => {
  it("shows whether the address is free", async () => {
    const creation = vi.fn(async (_ns: string, name: string) => {
      if (name === "alice") throw new ApiError(404, "not_found");
      return {} as never;
    });
    renderWithApp(<AddressHarness initial="alice" />, fakeClient({ creation }));
    await waitFor(() => expect(screen.getByText(/Available\./)).toBeTruthy(), { timeout: 2000 });
    const input = screen.getByLabelText("Address");
    await userEvent.clear(input);
    await userEvent.type(input, "taken");
    await waitFor(() => expect(screen.getByText(/Already used in this namespace/)).toBeTruthy(), {
      timeout: 2000,
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(creation).toHaveBeenCalledWith("writer", "taken");
  });

  it("rejects a malformed address without asking the registry", async () => {
    const creation = vi.fn();
    renderWithApp(<AddressHarness initial="-bad-" />, fakeClient({ creation }));
    expect(await screen.findByText(/start and end with a letter or digit/)).toBeTruthy();
    expect(creation).not.toHaveBeenCalled();
  });
});

describe("missingText", () => {
  it("lists what is still missing", () => {
    expect(missingText(["a rating", "the rights", "a license"])).toBe(
      "Choose a rating, the rights and a license to continue.",
    );
    expect(missingText(["a license"])).toBe("Choose a license to continue.");
    expect(missingText([])).toBe("");
  });
});
