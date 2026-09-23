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
  | { kind: "invalid"; diagnostics: CheckDiagnostic[]; message: string | undefined }
  | { kind: "error"; message: string };

export interface DraftEditor {
  working: Working;
  version: number;
  state: SaveState;
  /** 最近一次成功保存时检查规则给出的警告。 */
  warnings: CheckDiagnostic[];
  update(fn: (w: Working) => Working): void;
  /** 立即保存尚未保存的修改；返回草稿是否已经与服务端一致。 */
  flush(): Promise<boolean>;
  /** 丢弃本地修改，重新读取服务端的草稿。 */
  reload(): Promise<void>;
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
  opts: { debounceMs?: number } = {},
): DraftEditor {
  const debounceMs = opts.debounceMs ?? 800;
  const [working, setWorking] = useState<Working>(() => initial.working as Working);
  const [version, setVersion] = useState(initial.version);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: null });
  const [warnings, setWarnings] = useState<CheckDiagnostic[]>([]);
  const current = useRef<Working>(initial.working as Working);
  const versionRef = useRef(initial.version);
  const pending = useRef<Working | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflict = useRef(false);
  const lastOk = useRef(true);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    if (conflict.current) return false;
    const w = pending.current;
    if (!w) return lastOk.current;
    pending.current = null;
    setState({ kind: "saving" });
    const run = (async () => {
      try {
        const r = await client.putDraft(ns, name, versionRef.current, w);
        versionRef.current = r.version;
        setVersion(r.version);
        setWarnings(
          r.warnings.map(({ detail, ...d }) => (detail === undefined ? d : { ...d, detail })),
        );
        lastOk.current = true;
        noteWriteSucceeded();
        setState(pending.current ? { kind: "dirty" } : { kind: "saved", at: new Date() });
        return true;
      } catch (e) {
        lastOk.current = false;
        // 自动保存不经过 React Query：自己把错误交给全站只读提示。
        noteApiError(e);
        if (isApiError(e) && e.status === 409) {
          conflict.current = true;
          setState({ kind: "conflict" });
        } else if (isApiError(e) && e.status === 422) {
          setState({ kind: "invalid", diagnostics: diagnosticsOf(e), message: e.detail });
        } else {
          // 网络或服务端错误：保留这份修改，下一次修改或手动重试时再保存。
          pending.current ??= w;
          setState({ kind: "error", message: "Could not save. Your changes are kept here." });
        }
        return false;
      }
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    return ok && pending.current === null;
  }, [client, ns, name]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), debounceMs);
  }, [saveNow, debounceMs]);

  const update = useCallback(
    (fn: (w: Working) => Working) => {
      if (conflict.current) return;
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

  const reload = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    const d = await client.draft(ns, name);
    pending.current = null;
    conflict.current = false;
    lastOk.current = true;
    versionRef.current = d.version;
    setVersion(d.version);
    current.current = d.working as Working;
    setWorking(d.working as Working);
    setWarnings([]);
    setState({ kind: "saved", at: null });
  }, [client, ns, name]);

  // 离开页面时还有没保存的修改：让浏览器提示用户。
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      clearTimeout(timer.current);
    };
  }, []);

  return { working, version, state, warnings, update, flush, reload };
}
