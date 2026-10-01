import { type CreationInput, canonicalizeCreation, type ReleaseInput } from "@char-pub/core";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { keys } from "@/lib/registry";
import { buildTestCreation } from "@/test/build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { DeriveCreation } from "./derive-creation";

function fixture(
  options: {
    license?: string;
    rating?: "general" | "mature";
    release?: string;
    dependencyLicense?: string;
    assetLicense?: string;
  } = {},
) {
  const source: CreationInput = {
    id: "cr_01j00000000000000000000001",
    ref: "@writer/inn",
    type: "scenario",
    display_name: "Inn",
    meta: {
      default_locale: "en",
      rating: options.rating ?? "general",
      rights: "original",
      license: options.license ?? "CC-BY-4.0",
    },
    cast: [{ key: "player", who: { late: "persona" } }],
    fragments: [
      {
        id: "premise",
        kind: "scenario",
        stable: true,
        content: { type: "text", text: "A closed mountain road." },
      },
    ],
    story: {
      version: 1,
      scenes: [{ id: "hall", title: "Hall" }],
      endings: [
        { id: "home", title: { en: "Safe home", de: "Zuhause" }, description: "The storm passes." },
      ],
    },
  };
  const dependencies: ReleaseInput[] = [];
  if (options.dependencyLicense) {
    const dependency = canonicalizeCreation({
      id: "cr_01j00000000000000000000002",
      ref: "@writer/guest",
      type: "character",
      display_name: "Guest",
      meta: {
        default_locale: "en",
        rating: "general",
        rights: "original",
        license: options.dependencyLicense,
      },
      fragments: [
        {
          id: "description",
          kind: "character",
          stable: true,
          content: { type: "text", text: "A careful traveler." },
        },
      ],
    });
    const release = "rel_01j00000000000000000000002";
    source.references = [
      {
        id: "guest",
        use: "@writer/guest",
        mode: "intrinsic",
        pin: { release, semantic_digest: dependency.semantic_digest },
      },
    ];
    dependencies.push({
      creation: dependency.json,
      release,
      semantic_digest: dependency.semantic_digest,
      visibility: "public",
    });
  }
  if (options.assetLicense)
    source.assets = [
      {
        slot: "portrait",
        role: "presentation",
        variants: [
          {
            id: "default",
            license: options.assetLicense,
            media_type: "image/png",
            blob: { digest: `sha256:${"a".repeat(64)}`, size: 1, availability: "mirrored" },
          },
        ],
      },
    ];
  const canonical = canonicalizeCreation(source);
  const id = options.release ?? "rel_01j00000000000000000000001";
  return {
    artifact: buildTestCreation({
      dependencies,
      root: {
        creation: canonical.json,
        release: id,
        semantic_digest: canonical.semantic_digest,
        visibility: "public",
      },
    }).artifact,
    release: {
      id,
      label: "1.0.0",
      semantic_digest: canonical.semantic_digest,
      status: "active" as const,
    },
    sourceName: "Inn",
    sourceType: "scenario" as const,
  };
}
const created = { id: "cr_new", ref: "@writer/inn-remix", type: "scenario" as const };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("submits only the exact selected source with explicit rights confirmation, never browser working", async () => {
  const value = fixture();
  const deriveCreation = vi.fn(async () => created);
  const onCreated = vi.fn();
  renderWithApp(
    <DeriveCreation {...value} onCreated={onCreated} />,
    fakeClient({ me: async () => ME, deriveCreation }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  const submit = screen.getByRole("button", { name: "Create remix draft" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("@writer/inn@1.0.0")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Source licenses" }).textContent).toContain("CC-BY-4.0");
  await userEvent.click(screen.getByRole("checkbox", { name: /I confirm I can adapt/ }));
  await userEvent.click(submit);
  await waitFor(() =>
    expect(deriveCreation).toHaveBeenCalledExactlyOnceWith("writer", {
      source: {
        ref: "@writer/inn",
        release: value.release.id,
        semantic_digest: value.release.semantic_digest,
      },
      kind: "remix",
      name: "inn-remix",
      display_name: "Inn remix",
      rights_ack: { inbound_equals_outbound: true },
    }),
  );
  expect(onCreated).toHaveBeenCalledExactlyOnceWith(created.ref);
});

it("offers static authored endings for a sequel and leaves runtime state out of the request", async () => {
  const deriveCreation = vi.fn(async () => created);
  renderWithApp(
    <DeriveCreation {...fixture()} onCreated={() => {}} />,
    fakeClient({ me: async () => ME, deriveCreation }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Create sequel" }));
  expect(screen.getByText(/not a player's saved session/)).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Ending to continue from"), "home");
  await userEvent.click(screen.getByRole("checkbox", { name: /I confirm I can adapt/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create sequel draft" }));
  await waitFor(() =>
    expect(deriveCreation).toHaveBeenCalledWith(
      "writer",
      expect.objectContaining({ kind: "sequel", ending: "home" }),
    ),
  );
});

it.each(["CC-BY-ND-4.0", "LicenseRef-All-Rights-Reserved"])(
  "hides derivation when %s does not permit adaptation",
  async (license) => {
    const me = vi.fn(async () => ME);
    renderWithApp(<DeriveCreation {...fixture({ license })} />, fakeClient({ me }));
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Remix" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create sequel" })).toBeNull();
  },
);

it("accepts an allowed license alternative and hides sequel for other creation types", async () => {
  renderWithApp(
    <DeriveCreation
      {...fixture({ license: "CC-BY-ND-4.0 OR CC-BY-4.0" })}
      sourceType="character"
    />,
    fakeClient({ me: async () => ME }),
  );
  expect(await screen.findByRole("button", { name: "Remix" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create sequel" })).toBeNull();
});

it("does not guess permission without a loaded artifact matching the selected release", async () => {
  const value = fixture();
  const me = vi.fn(async () => ME);
  const { unmount } = renderWithApp(
    <DeriveCreation {...value} artifact={undefined} />,
    fakeClient({ me }),
  );
  await waitFor(() => expect(me).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Remix" })).toBeNull();
  unmount();
  renderWithApp(
    <DeriveCreation
      {...value}
      release={{ ...value.release, id: "rel_01j00000000000000000000002" }}
    />,
    fakeClient({ me: async () => ME }),
  );
  expect(screen.queryByRole("button", { name: "Remix" })).toBeNull();
});

it.each(["yanked", "tombstoned"] as const)(
  "hides derivation for a %s source release",
  async (status) => {
    const value = fixture();
    const me = vi.fn(async () => ME);
    renderWithApp(
      <DeriveCreation {...value} release={{ ...value.release, status }} />,
      fakeClient({ me }),
    );
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Remix" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create sequel" })).toBeNull();
  },
);

it("preserves the user's choices on a retry and prevents duplicate pending submissions", async () => {
  const pending = deferred<typeof created>();
  const deriveCreation = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(409, "creation.conflict", "conflict"))
    .mockImplementationOnce(() => pending.promise);
  renderWithApp(
    <DeriveCreation {...fixture()} onCreated={() => {}} />,
    fakeClient({ me: async () => ME, deriveCreation }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  await userEvent.clear(screen.getByLabelText("New title"));
  await userEvent.type(screen.getByLabelText("New title"), "My own Inn");
  await userEvent.click(screen.getByRole("checkbox", { name: /I confirm I can adapt/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create remix draft" }));
  expect((await screen.findByRole("alert")).textContent).toContain("already used");
  expect((screen.getByLabelText("New title") as HTMLInputElement).value).toBe("My own Inn");
  await userEvent.clear(screen.getByLabelText("New address"));
  await userEvent.type(screen.getByLabelText("New address"), "other-inn");
  await userEvent.dblClick(screen.getByRole("button", { name: "Create remix draft" }));
  expect(deriveCreation).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(created));
});

it("keeps adult ending text and submit controls behind the existing rating gate", async () => {
  renderWithApp(
    <DeriveCreation {...fixture({ rating: "mature" })} />,
    fakeClient({ me: async () => ME }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Create sequel" }));
  expect(screen.queryByLabelText("Ending to continue from")).toBeNull();
  expect(screen.queryByRole("button", { name: "Create sequel draft" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Show this once" }));
  expect(screen.getByRole("option", { name: "Safe home (home)" })).toBeTruthy();
});

it("requires a signed-in personal namespace before the derivation form", async () => {
  const { unmount } = renderWithApp(
    <DeriveCreation {...fixture()} />,
    fakeClient({ me: async () => null }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  expect(screen.getByText("Sign in to create your own version")).toBeTruthy();
  unmount();
  renderWithApp(
    <DeriveCreation {...fixture()} />,
    fakeClient({ me: async () => ({ ...ME, namespace: null }) }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  expect(screen.getByText("First, choose your name on char.pub")).toBeTruthy();
});

it("ignores a late creation response after the actor changes", async () => {
  const pending = deferred<typeof created>();
  const onCreated = vi.fn();
  const { queryClient } = renderWithApp(
    <DeriveCreation {...fixture()} onCreated={onCreated} />,
    fakeClient({ me: async () => ME, deriveCreation: () => pending.promise }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /I confirm I can adapt/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create remix draft" }));
  act(() => queryClient.setQueryData(keys.me, { ...ME, id: "usr_other", namespace: "other" }));
  await act(async () => pending.resolve(created));
  expect(onCreated).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("ignores a late creation response after the selected version changes", async () => {
  const pending = deferred<typeof created>();
  const onCreated = vi.fn();
  const first = fixture();
  const second = fixture({ release: "rel_01j00000000000000000000002" });
  function Versions() {
    const [next, setNext] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setNext(true)}>
          Switch source version
        </button>
        <DeriveCreation {...(next ? second : first)} onCreated={onCreated} />
      </>
    );
  }
  renderWithApp(
    <Versions />,
    fakeClient({ me: async () => ME, deriveCreation: () => pending.promise }),
  );
  const switchButton = await screen.findByRole("button", { name: "Switch source version" });
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /I confirm I can adapt/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create remix draft" }));
  // Programmatic navigation can occur while a modal request is pending.
  act(() => switchButton.click());
  await act(async () => pending.resolve(created));
  expect(onCreated).not.toHaveBeenCalled();
});

it("does not navigate when a pending creation finishes after the dialog is closed", async () => {
  const pending = deferred<typeof created>();
  const onCreated = vi.fn();
  renderWithApp(
    <DeriveCreation {...fixture()} onCreated={onCreated} />,
    fakeClient({ me: async () => ME, deriveCreation: () => pending.promise }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Remix" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /I confirm I can adapt/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create remix draft" }));
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => pending.resolve(created));
  expect(onCreated).not.toHaveBeenCalled();
});

it("allows a CC0 root that references an unchanged ND Character", async () => {
  const value = fixture({ license: "CC0-1.0", dependencyLicense: "CC-BY-ND-4.0" });
  expect(value.artifact.meta.licenses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ref: "@writer/guest", license: "CC-BY-ND-4.0" }),
    ]),
  );
  renderWithApp(<DeriveCreation {...value} />, fakeClient({ me: async () => ME }));
  expect(await screen.findByRole("button", { name: "Remix" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create sequel" })).toBeTruthy();
});

it("allows an ND root asset when the original bytes may be redistributed", async () => {
  const value = fixture({ license: "CC0-1.0", assetLicense: "CC-BY-ND-4.0" });
  expect(value.artifact.assets).toEqual(
    expect.arrayContaining([expect.objectContaining({ license: "CC-BY-ND-4.0" })]),
  );
  renderWithApp(<DeriveCreation {...value} />, fakeClient({ me: async () => ME }));
  expect(await screen.findByRole("button", { name: "Remix" })).toBeTruthy();
});

it("hides derivation when a root asset cannot be redistributed", async () => {
  const me = vi.fn(async () => ME);
  const value = fixture({ license: "CC0-1.0", assetLicense: "LicenseRef-All-Rights-Reserved" });
  renderWithApp(<DeriveCreation {...value} />, fakeClient({ me }));
  await waitFor(() => expect(me).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Remix" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Create sequel" })).toBeNull();
});
