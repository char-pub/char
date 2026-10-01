/**
 * 草稿编辑状态与自动保存。
 *
 * - 每次修改后等待一小段时间（防抖）再保存，保存时带 `If-Match: <version>`；
 * - 服务端返回 409 说明草稿在别处被改过：停止自动保存，由用户决定重新加载；
 * - 服务端的检查规则发现错误时返回 422 与诊断，草稿不会被保存，界面就地显示诊断，
 *   用户修正后下一次修改会再次尝试；警告随成功的响应一起返回。
 * - 同一时间最多只有一个保存请求；保存过程中的新修改在它完成后接着保存。
 * - 保存不经过 React Query，所以错误和成功要自己通知全站只读提示（503 `feature.read_only`
 *   时点亮，任何一次保存成功就熄灭）。
 */
import type { CheckDiagnostic } from "@char-pub/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Draft, isApiError, type RegistryClient } from "./api";
import type { Working } from "./draft";
import { noteApiError, noteWriteSucceeded } from "./read-only";

export type SaveState =
  | { kind: "saved"; at: Date | null }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "conflict" }
  | { kind: "denied" }
  | { kind: "invalid"; diagnostics: CheckDiagnostic[]; message: string | undefined }
  | { kind: "error"; message: string };

export interface SavedDraftSnapshot {
  working: Working;
  version: number;
}

export interface DraftConflict {
  base: Working;
  local: Working;
  latest: Working;
  version: number;
}

export interface DraftEditor {
  working: Working;
  version: number;
  state: SaveState;
  /** 最近一次成功保存时检查规则给出的警告。 */
  warnings: CheckDiagnostic[];
  update(fn: (w: Working) => Working): void;
  /** 立即保存尚未保存的修改；返回草稿是否已经与服务端一致。 */
  flush(): Promise<boolean>;
  flushSnapshot(): Promise<SavedDraftSnapshot | null>;
  /** 丢弃本地修改，重新读取服务端的草稿。 */
  reload(): Promise<void>;
  /** Read a new comparison without discarding local edits or sending writes. */
  reviewConflict(): Promise<DraftConflict | null>;
  /** Apply only a comparison still owned by this editor, with its exact server version. */
  reapplyConflict(review: DraftConflict, working: Working): Promise<boolean>;
}

function diagnosticsOf(e: { extra: Record<string, unknown> }): CheckDiagnostic[] {
  const d = e.extra.diagnostics;
  return Array.isArray(d) ? (d as CheckDiagnostic[]) : [];
}

export function useDraftEditor(
  client: RegistryClient,
  ns: string,
  name: string,
  initial: Draft,
  opts: { debounceMs?: number; isCurrent?: () => boolean } = {},
): DraftEditor {
  const debounceMs = opts.debounceMs ?? 800;
  const guard = useRef(opts.isCurrent);
  guard.current = opts.isCurrent;
  const isCurrent = () => !disposed.current && (guard.current?.() ?? true);
  const [working, setWorking] = useState<Working>(() => initial.working as Working);
  const [version, setVersion] = useState(initial.version);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: null });
  const [warnings, setWarnings] = useState<CheckDiagnostic[]>([]);
  const current = useRef<Working>(initial.working as Working);
  const versionRef = useRef(initial.version);
  const saved = useRef<Working>(initial.working as Working);
  const pending = useRef<Working | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflict = useRef(false);
  const lastOk = useRef(true);
  const disposed = useRef(false);
  const recoveryEpoch = useRef(0);
  const reviewed = useRef<DraftConflict | null>(null);

  const saveNow = useCallback((): Promise<boolean> => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      if (conflict.current || !isCurrent()) return false;
      while (pending.current && isCurrent()) {
        const w = pending.current;
        pending.current = null;
        setState({ kind: "saving" });
        try {
          const result = await client.putDraft(ns, name, versionRef.current, w);
          if (!isCurrent()) return false;
          versionRef.current = result.version;
          saved.current = w;
          setVersion(result.version);
          setWarnings(
            result.warnings.map(({ detail, ...d }) =>
              detail === undefined ? d : { ...d, detail },
            ),
          );
          lastOk.current = true;
          noteWriteSucceeded();
        } catch (error) {
          if (!isCurrent()) return false;
          lastOk.current = false;
          noteApiError(error);
          if (isApiError(error) && error.status === 409) {
            conflict.current = true;
            setState({ kind: "conflict" });
          } else if (isApiError(error) && [401, 403, 404].includes(error.status)) {
            conflict.current = true;
            pending.current ??= w;
            setState({ kind: "denied" });
          } else if (isApiError(error) && error.status === 422) {
            setState({ kind: "invalid", diagnostics: diagnosticsOf(error), message: error.detail });
          } else {
            pending.current ??= w;
            setState({ kind: "error", message: "Could not save. Your changes are kept here." });
          }
          return false;
        }
      }
      if (!isCurrent()) return false;
      if (lastOk.current) setState({ kind: "saved", at: new Date() });
      return lastOk.current;
    })();
    const tracked = run.finally(() => {
      if (inflight.current === tracked) inflight.current = null;
    });
    inflight.current = tracked;
    return tracked;
  }, [client, ns, name]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), debounceMs);
  }, [saveNow, debounceMs]);

  const update = useCallback(
    (fn: (w: Working) => Working) => {
      if (conflict.current || !isCurrent()) return;
      // 在事件处理中同步算出新草稿，保证随后的 flush() 一定能看到这次修改。
      const next = fn(current.current);
      current.current = next;
      pending.current = next;
      setWorking(next);
      setState({ kind: "dirty" });
      schedule();
    },
    [schedule],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    return saveNow();
  }, [saveNow]);

  const flushSnapshot = useCallback(async (): Promise<SavedDraftSnapshot | null> => {
    if (!(await flush()) || !isCurrent()) return null;
    return { working: saved.current, version: versionRef.current };
  }, [flush]);

  const reload = useCallback(async () => {
    const epoch = ++recoveryEpoch.current;
    reviewed.current = null;
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (!isCurrent() || epoch !== recoveryEpoch.current) return;
    const d = await client.draft(ns, name);
    if (!isCurrent() || epoch !== recoveryEpoch.current) return;
    pending.current = null;
    conflict.current = false;
    lastOk.current = true;
    versionRef.current = d.version;
    setVersion(d.version);
    current.current = d.working as Working;
    saved.current = current.current;
    setWorking(d.working as Working);
    setWarnings([]);
    setState({ kind: "saved", at: null });
  }, [client, ns, name]);

  const reviewConflict = useCallback(async (): Promise<DraftConflict | null> => {
    if (!conflict.current || !isCurrent()) return null;
    const epoch = ++recoveryEpoch.current;
    reviewed.current = null;
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (!isCurrent() || epoch !== recoveryEpoch.current) return null;
    try {
      const latest = await client.draft(ns, name);
      if (!isCurrent() || epoch !== recoveryEpoch.current || !conflict.current) return null;
      const review = {
        base: saved.current,
        local: current.current,
        latest: latest.working as Working,
        version: latest.version,
      };
      reviewed.current = review;
      return review;
    } catch (error) {
      if (!isCurrent() || epoch !== recoveryEpoch.current) return null;
      noteApiError(error);
      if (isApiError(error) && [401, 403, 404].includes(error.status)) setState({ kind: "denied" });
      throw error;
    }
  }, [client, ns, name]);

  const reapplyConflict = useCallback(
    async (review: DraftConflict, next: Working): Promise<boolean> => {
      if (
        !isCurrent() ||
        !conflict.current ||
        reviewed.current !== review ||
        current.current !== review.local ||
        saved.current !== review.base
      )
        return false;
      recoveryEpoch.current++;
      reviewed.current = null;
      clearTimeout(timer.current);
      pending.current = next;
      current.current = next;
      saved.current = review.latest;
      versionRef.current = review.version;
      conflict.current = false;
      lastOk.current = false;
      setWorking(next);
      setVersion(review.version);
      setWarnings([]);
      setState({ kind: "dirty" });
      return saveNow();
    },
    [saveNow],
  );

  // 离开页面时还有没保存的修改：让浏览器提示用户。
  useEffect(() => {
    disposed.current = false;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (current.current !== saved.current || pending.current || inflight.current)
        e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      disposed.current = true;
      recoveryEpoch.current++;
      reviewed.current = null;
      pending.current = null;
      window.removeEventListener("beforeunload", onUnload);
      clearTimeout(timer.current);
    };
  }, []);

  return {
    working,
    version,
    state,
    warnings,
    update,
    flush,
    flushSnapshot,
    reload,
    reviewConflict,
    reapplyConflict,
  };
}
