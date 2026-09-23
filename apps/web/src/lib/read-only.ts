/**
 * 全站只读模式的提示。
 *
 * 服务端打开 `read_only` 开关时，所有写操作返回 503 `feature.read_only`；单项功能被关闭
 * （publish、contributions、uploads、guest_access）时返回 503 `feature.disabled`。
 * 只有前者能确定是全站只读，所以只有它会点亮顶部的提示条；后者由出错的位置自己说明
 * （例如 `ErrorState` 会显示成“暂时不可用”）。
 *
 * QueryClient 的 QueryCache / MutationCache 把错误交给 `noteApiError`（见 main.tsx）；
 * 不经过 React Query 的调用（例如自动保存）可以自己调用它。任何一次写操作成功就说明只读
 * 已经解除，提示条随之消失。
 */
import { useSyncExternalStore } from "react";
import { isApiError } from "./api";

let readOnly = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (readOnly === next) return;
  readOnly = next;
  for (const l of listeners) l();
}

export function isReadOnlyError(error: unknown): boolean {
  return isApiError(error, "feature.read_only");
}

/** 查看一个请求错误：是全站只读时点亮提示条。 */
export function noteApiError(error: unknown): void {
  if (isReadOnlyError(error)) set(true);
}

/** 写操作成功：只读已经解除。 */
export function noteWriteSucceeded(): void {
  set(false);
}

export function useReadOnly(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => readOnly,
    () => false,
  );
}
