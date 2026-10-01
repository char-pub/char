/** The edit route must partition real React Query draft caches by the signed-in account. */
import type { CreationDetail, Draft } from "@char-pub/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { keys, RegistryProvider } from "@/lib/registry";
import { routeTree } from "@/routeTree.gen";
import { fakeClient, ME } from "@/test/render";

// Isolate the route's admission boundary; the editor's save/preview behavior has owner-local tests.
vi.mock("@/components/editor/editor", () => ({
  Editor: ({ draft }: { draft: Draft }) => (
    <section data-testid="admitted-editor">{JSON.stringify(draft.working)}</section>
  ),
}));

const SECOND = { ...ME, id: "usr_01j00000000000000000000001", name: "Public reader" };
const PRIVATE_TEXT = "FIRST_ACCOUNT_PRIVATE_DRAFT";
const PRIVATE_DRAFT: Draft = {
  version: 7,
  working: { display_name: PRIVATE_TEXT },
  base_revision_id: null,
  updated_at: "2026-10-01T00:00:00.000Z",
};
const PUBLIC_DETAIL: CreationDetail = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/story",
  type: "character",
  display_name: "Public character",
  rating: "general",
  tags: [],
  contribution_policy: "closed",
  dependents_count: 0,
  releases: [
    {
      id: "rel_01j00000000000000000000000",
      label: "1",
      visibility: "public",
      status: "active",
      semantic_digest: `sha256:${"a".repeat(64)}`,
      effective_rating: "general",
      created_at: "2026-10-01T00:00:00.000Z",
    },
  ],
};

function deferred<T>() {
  let resolve = (_value: T) => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function setup(readDraft: (account: string) => Promise<Draft>) {
  let account = ME;
  const draftCalls: string[] = [];
  const putDraft = vi
    .fn()
    .mockRejectedValue(new Error("No editor should submit after account switch"));
  const client = fakeClient({
    me: async () => account,
    guestMe: async () => null,
    creation: async () => PUBLIC_DETAIL,
    draft: async () => {
      draftCalls.push(account.id);
      return readDraft(account.id);
    },
    putDraft,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/c/writer/story/edit"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RegistryProvider client={client}>
        <RouterProvider router={router} />
      </RegistryProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("main");
  return {
    draftCalls,
    putDraft,
    queryClient,
    async switchAccount() {
      account = SECOND;
      await act(async () => {
        queryClient.setQueryData(keys.me, SECOND);
      });
    },
  };
}

it("does not reuse a previous account's infinitely fresh private draft when the next account can read public details", async () => {
  const denied = deferred<Draft>();
  const app = await setup((account) =>
    account === ME.id ? Promise.resolve(PRIVATE_DRAFT) : denied.promise,
  );
  expect((await screen.findByTestId("admitted-editor")).textContent).toContain(PRIVATE_TEXT);
  expect(app.queryClient.getQueryData([...keys.draft("writer", "story"), ME.id])).toEqual(
    PRIVATE_DRAFT,
  );
  await app.switchAccount();
  await waitFor(() => expect(app.draftCalls).toEqual([ME.id, SECOND.id]));
  expect(screen.queryByTestId("admitted-editor")).toBeNull();
  expect(screen.queryByText(PRIVATE_TEXT, { exact: false })).toBeNull();
  await act(async () => {
    denied.reject(new ApiError(404, "not_found", "Private draft is unavailable"));
  });
  await screen.findByRole("heading", { name: "You can't edit this creation" });
  expect(app.queryClient.getQueryData([...keys.creation("writer", "story"), SECOND.id])).toEqual(
    PUBLIC_DETAIL,
  );
  expect(screen.queryByTestId("admitted-editor")).toBeNull();
  expect(app.putDraft).not.toHaveBeenCalled();
});

it("does not admit a late first-account draft response after the second account's authorization fails", async () => {
  const first = deferred<Draft>();
  const app = await setup((account) =>
    account === ME.id ? first.promise : Promise.reject(new ApiError(404, "not_found")),
  );
  await waitFor(() => expect(app.draftCalls).toEqual([ME.id]));
  await app.switchAccount();
  await screen.findByRole("heading", { name: "You can't edit this creation" });
  await act(async () => {
    first.resolve(PRIVATE_DRAFT);
  });
  expect(app.draftCalls).toEqual([ME.id, SECOND.id]);
  expect(screen.queryByTestId("admitted-editor")).toBeNull();
  expect(screen.queryByText(PRIVATE_TEXT, { exact: false })).toBeNull();
  expect(app.putDraft).not.toHaveBeenCalled();
});
