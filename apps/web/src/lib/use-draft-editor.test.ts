import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { fakeClient } from "@/test/render";
import { ApiError, type Draft, type PutDraftResponse } from "./api";
import { useDraftEditor } from "./use-draft-editor";

const initial: Draft = {
  version: 1,
  working: { display_name: "Original" },
  base_revision_id: null,
  updated_at: "2026-10-01T00:00:00.000Z",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const saved = (version: number): PutDraftResponse => ({
  version,
  semantic_digest: `sha256:${"a".repeat(64)}`,
  warnings: [],
});

it.each([409, 422])(
  "retains the leave-page warning after a rejected save %s drains its queue",
  async (status) => {
    const putDraft = vi
      .fn()
      .mockRejectedValue(
        new ApiError(status, status === 409 ? "draft.version_conflict" : "check.failed"),
      );
    const client = fakeClient({ putDraft, draft: async () => initial });
    const { result } = renderHook(() =>
      useDraftEditor(client, "writer", "work", initial, { debounceMs: 60_000 }),
    );
    await act(async () => {
      result.current.update((working) => ({ ...working, display_name: "Unsaved text" }));
      expect(await result.current.flushSnapshot()).toBeNull();
    });
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    expect(result.current.working.display_name).toBe("Unsaved text");
    expect(putDraft).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.reload();
    });
    const afterReload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterReload);
    expect(afterReload.defaultPrevented).toBe(false);
  },
);

it("all concurrent flushes wait for the full drain and return the matching saved version", async () => {
  const first = deferred<PutDraftResponse>(),
    second = deferred<PutDraftResponse>();
  const putDraft = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const client = fakeClient({ putDraft });
  const { result } = renderHook(() =>
    useDraftEditor(client, "writer", "work", initial, { debounceMs: 60_000 }),
  );
  let p1!: ReturnType<typeof result.current.flushSnapshot>;
  act(() => {
    result.current.update((w) => ({ ...w, display_name: "First" }));
    p1 = result.current.flushSnapshot();
  });
  let p2!: typeof p1, p3!: typeof p1;
  let settled = false;
  act(() => {
    result.current.update((w) => ({ ...w, display_name: "Second" }));
    p2 = result.current.flushSnapshot();
    p3 = result.current.flushSnapshot();
    void p3.then(() => {
      settled = true;
    });
  });
  expect(putDraft).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve(saved(2));
    await first.promise;
  });
  expect(putDraft).toHaveBeenCalledTimes(2);
  expect(putDraft.mock.calls[1]).toEqual(["writer", "work", 2, { display_name: "Second" }]);
  expect(settled).toBe(false);
  await act(async () => {
    second.resolve(saved(3));
    await Promise.all([p1, p2, p3]);
  });
  for (const promise of [p1, p2, p3])
    expect(await promise).toEqual({ working: { display_name: "Second" }, version: 3 });
});

it("does not send queued edits or expose a saved snapshot after the account/work editor unmounts", async () => {
  const first = deferred<PutDraftResponse>();
  const putDraft = vi.fn(() => first.promise);
  const client = fakeClient({ putDraft });
  const { result, unmount } = renderHook(() =>
    useDraftEditor(client, "writer", "work", initial, { debounceMs: 60_000 }),
  );
  let pending!: ReturnType<typeof result.current.flushSnapshot>;
  act(() => {
    result.current.update((w) => ({ ...w, display_name: "First" }));
    pending = result.current.flushSnapshot();
    result.current.update((w) => ({ ...w, display_name: "Private queued edit" }));
  });
  unmount();
  first.resolve(saved(2));
  expect(await pending).toBeNull();
  expect(putDraft).toHaveBeenCalledTimes(1);
});

it("keeps a failed save for explicit retry without looping or returning an unsaved snapshot", async () => {
  const putDraft = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(saved(2));
  const client = fakeClient({ putDraft });
  const { result } = renderHook(() =>
    useDraftEditor(client, "writer", "work", initial, { debounceMs: 60_000 }),
  );
  let snapshot: unknown;
  await act(async () => {
    result.current.update((w) => ({ ...w, display_name: "Keep me" }));
    snapshot = await result.current.flushSnapshot();
  });
  expect(snapshot).toBeNull();
  expect(putDraft).toHaveBeenCalledTimes(1);
  expect(result.current.working.display_name).toBe("Keep me");
  await act(async () => {
    snapshot = await result.current.flushSnapshot();
  });
  expect(snapshot).toEqual({ working: { display_name: "Keep me" }, version: 2 });
  expect(putDraft.mock.calls[1]?.[2]).toBe(1);
});

it("checks the current account before draining, even before React unmounts the old editor", async () => {
  const first = deferred<PutDraftResponse>();
  const putDraft = vi.fn(() => first.promise);
  let current = true;
  const client = fakeClient({ putDraft });
  const { result } = renderHook(() =>
    useDraftEditor(client, "writer", "work", initial, {
      debounceMs: 60_000,
      isCurrent: () => current,
    }),
  );
  let pending!: ReturnType<typeof result.current.flushSnapshot>;
  act(() => {
    result.current.update((w) => ({ ...w, display_name: "First" }));
    pending = result.current.flushSnapshot();
    result.current.update((w) => ({ ...w, display_name: "Queued private change" }));
  });
  current = false;
  await act(async () => {
    first.resolve(saved(2));
    await pending;
  });
  expect(await pending).toBeNull();
  expect(putDraft).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 404])(
  "stops queued and subsequent writes after access denial %s and keeps the latest unsaved content",
  async (status) => {
    let reject!: (reason: unknown) => void;
    const response = new Promise<PutDraftResponse>((_resolve, fail) => {
      reject = fail;
    });
    const putDraft = vi.fn(() => response);
    const client = fakeClient({ putDraft });
    const { result } = renderHook(() =>
      useDraftEditor(client, "writer", "work", initial, { debounceMs: 60_000 }),
    );
    let pending!: ReturnType<typeof result.current.flushSnapshot>;
    act(() => {
      result.current.update((w) => ({ ...w, display_name: "First edit" }));
      pending = result.current.flushSnapshot();
      result.current.update((w) => ({ ...w, display_name: "Latest unsaved edit" }));
    });
    await act(async () => {
      reject(new ApiError(status, "not_found"));
      await pending;
    });
    expect(await pending).toBeNull();
    expect(result.current.state.kind).toBe("denied");
    expect(result.current.working.display_name).toBe("Latest unsaved edit");
    await act(async () => {
      expect(await result.current.flushSnapshot()).toBeNull();
    });
    expect(putDraft).toHaveBeenCalledTimes(1);
  },
);

it("reviews without writing and reapplies against the exact reviewed version", async () => {
  const latest = {
    ...initial,
    version: 7,
    working: { display_name: "Original", summary: "Remote" },
  };
  const putDraft = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(409, "draft.version_conflict"))
    .mockResolvedValueOnce(saved(8));
  const client = fakeClient({ putDraft, draft: async () => latest });
  const { result } = renderHook(() =>
    useDraftEditor(client, "writer", "work", initial, { debounceMs: 60_000 }),
  );
  await act(async () => {
    result.current.update((w) => ({ ...w, display_name: "Local" }));
    await result.current.flush();
  });
  let review!: NonNullable<Awaited<ReturnType<typeof result.current.reviewConflict>>>;
  await act(async () => {
    const value = await result.current.reviewConflict();
    if (!value) throw new Error("missing review");
    review = value;
  });
  expect(review).toEqual({
    base: initial.working,
    local: { display_name: "Local" },
    latest: latest.working,
    version: 7,
  });
  expect(result.current.working.display_name).toBe("Local");
  expect(result.current.version).toBe(1);
  expect(putDraft).toHaveBeenCalledTimes(1);
  await act(async () => {
    expect(
      await result.current.reapplyConflict(review, { ...latest.working, display_name: "Local" }),
    ).toBe(true);
  });
  expect(putDraft.mock.calls[1]).toEqual([
    "writer",
    "work",
    7,
    { display_name: "Local", summary: "Remote" },
  ]);
  expect(result.current.state.kind).toBe("saved");
  expect(result.current.version).toBe(8);
  expect(await result.current.reapplyConflict(review, { display_name: "Stale" })).toBe(false);
  expect(putDraft).toHaveBeenCalledTimes(2);
});

it("a second conflict retains the selected result and rebases the next comparison on its reviewed server draft", async () => {
  const firstRemote = {
    ...initial,
    version: 2,
    working: { display_name: "Remote", summary: "Keep" },
  };
  const nextRemote = {
    ...initial,
    version: 3,
    working: { display_name: "New remote", summary: "Keep" },
  };
  const draft = vi.fn().mockResolvedValueOnce(firstRemote).mockResolvedValueOnce(nextRemote);
  const putDraft = vi.fn().mockRejectedValue(new ApiError(409, "draft.version_conflict"));
  const { result } = renderHook(() =>
    useDraftEditor(fakeClient({ putDraft, draft }), "writer", "work", initial, {
      debounceMs: 60_000,
    }),
  );
  await act(async () => {
    result.current.update((w) => ({ ...w, display_name: "Local" }));
    await result.current.flush();
    const review = await result.current.reviewConflict();
    if (!review) throw new Error("missing review");
    expect(
      await result.current.reapplyConflict(review, { display_name: "Local", summary: "Keep" }),
    ).toBe(false);
  });
  expect(result.current.state.kind).toBe("conflict");
  expect(result.current.working).toEqual({ display_name: "Local", summary: "Keep" });
  await act(async () => {
    const review = await result.current.reviewConflict();
    expect(review?.base).toEqual(firstRemote.working);
    expect(review?.latest).toEqual(nextRemote.working);
    expect(review?.local).toEqual(result.current.working);
  });
  expect(putDraft).toHaveBeenCalledTimes(2);
});

it("a refreshed comparison invalidates prior choices even when its version did not change", async () => {
  const putDraft = vi.fn().mockRejectedValue(new ApiError(409, "draft.version_conflict"));
  const { result } = renderHook(() =>
    useDraftEditor(
      fakeClient({ putDraft, draft: async () => ({ ...initial, version: 2 }) }),
      "writer",
      "work",
      initial,
      { debounceMs: 60_000 },
    ),
  );
  await act(async () => {
    result.current.update((w) => ({ ...w, display_name: "Local" }));
    await result.current.flush();
    const old = await result.current.reviewConflict();
    await result.current.reviewConflict();
    if (!old) throw new Error("missing review");
    expect(await result.current.reapplyConflict(old, { display_name: "Stale" })).toBe(false);
  });
  expect(putDraft).toHaveBeenCalledTimes(1);
  expect(result.current.working.display_name).toBe("Local");
});

it("discarding during a pending comparison makes its late response unusable", async () => {
  const late = deferred<Draft>();
  const draft = vi
    .fn()
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce({ ...initial, version: 3 });
  const putDraft = vi.fn().mockRejectedValue(new ApiError(409, "draft.version_conflict"));
  const { result } = renderHook(() =>
    useDraftEditor(fakeClient({ putDraft, draft }), "writer", "work", initial, {
      debounceMs: 60_000,
    }),
  );
  let pendingReview!: ReturnType<typeof result.current.reviewConflict>;
  await act(async () => {
    result.current.update((w) => ({ ...w, display_name: "Local" }));
    await result.current.flush();
    pendingReview = result.current.reviewConflict();
    await result.current.reload();
    late.resolve({ ...initial, version: 2, working: { display_name: "Late" } });
    expect(await pendingReview).toBeNull();
  });
  expect(result.current.working).toEqual(initial.working);
  expect(result.current.version).toBe(3);
});

it.each([401, 403, 404])(
  "losing access during comparison %s preserves local edits and prevents recovery writes",
  async (status) => {
    const putDraft = vi.fn().mockRejectedValue(new ApiError(409, "draft.version_conflict"));
    const draft = vi.fn().mockRejectedValue(new ApiError(status, "not_found"));
    const { result } = renderHook(() =>
      useDraftEditor(fakeClient({ putDraft, draft }), "writer", "work", initial, {
        debounceMs: 60_000,
      }),
    );
    await act(async () => {
      result.current.update((w) => ({ ...w, display_name: "Local" }));
      await result.current.flush();
      await expect(result.current.reviewConflict()).rejects.toBeInstanceOf(ApiError);
    });
    expect(result.current.state.kind).toBe("denied");
    expect(result.current.working.display_name).toBe("Local");
    expect(putDraft).toHaveBeenCalledTimes(1);
  },
);

it("does not expose a late comparison after the account changes", async () => {
  const response = deferred<Draft>();
  let current = true;
  const putDraft = vi.fn().mockRejectedValue(new ApiError(409, "draft.version_conflict"));
  const { result } = renderHook(() =>
    useDraftEditor(
      fakeClient({ putDraft, draft: () => response.promise }),
      "writer",
      "work",
      initial,
      { debounceMs: 60_000, isCurrent: () => current },
    ),
  );
  let comparison!: ReturnType<typeof result.current.reviewConflict>;
  await act(async () => {
    result.current.update((w) => ({ ...w, display_name: "Local" }));
    await result.current.flush();
    comparison = result.current.reviewConflict();
    current = false;
    response.resolve({ ...initial, version: 2, working: { display_name: "Private response" } });
    expect(await comparison).toBeNull();
  });
  expect(result.current.working.display_name).toBe("Local");
  expect(putDraft).toHaveBeenCalledTimes(1);
});

it.each([422, 403])(
  "retains the complete recovery candidate when the new save fails with %s",
  async (status) => {
    const latest = {
      ...initial,
      version: 2,
      working: { display_name: "Original", summary: "Remote" },
    };
    const putDraft = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "draft.version_conflict"))
      .mockRejectedValueOnce(new ApiError(status, status === 422 ? "check.failed" : "forbidden"));
    const { result } = renderHook(() =>
      useDraftEditor(
        fakeClient({ putDraft, draft: async () => latest }),
        "writer",
        "work",
        initial,
        { debounceMs: 60_000 },
      ),
    );
    await act(async () => {
      result.current.update((w) => ({ ...w, display_name: "Local" }));
      await result.current.flush();
      const review = await result.current.reviewConflict();
      if (!review) throw new Error("missing review");
      expect(
        await result.current.reapplyConflict(review, { display_name: "Local", summary: "Remote" }),
      ).toBe(false);
    });
    expect(result.current.state.kind).toBe(status === 422 ? "invalid" : "denied");
    expect(result.current.working).toEqual({ display_name: "Local", summary: "Remote" });
    expect(putDraft).toHaveBeenCalledTimes(2);
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  },
);
