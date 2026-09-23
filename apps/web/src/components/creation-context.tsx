/**
 * 作品外框的数据：外框（`routes/c.$ns.$name.tsx`）读取作品详情、所选版本的 Release 详情和
 * Context IR，通过 context 交给各个标签页，标签页不必重复请求。
 *
 * 作品详情的查询 key 是 `creationDetailKey(ns, name, meId)`，也就是
 * `["creation", ns, name, meId | null]`：登录状态会改变能看到的版本（private），所以 key
 * 里带着当前用户。写操作之后按 `keys.creation(ns, name)` 前缀失效即可。
 */
import type { ContextIR, Rating } from "@char-pub/core";
import { type QueryClient, queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import {
  type CreationDetail,
  isApiError,
  type Me,
  type RegistryClient,
  type ReleaseDetail,
  type ReleaseSummary,
} from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { parseRef } from "@/lib/text";

export function creationDetailKey(ns: string, name: string, meId: string | null | undefined) {
  return [...keys.creation(ns, name), meId ?? null] as const;
}

export function creationDetailQuery(
  client: RegistryClient,
  ns: string,
  name: string,
  meId: string | null | undefined,
) {
  return queryOptions({
    queryKey: creationDetailKey(ns, name, meId),
    queryFn: () => client.creation(ns, name),
  });
}

/** 同一个 Release 的 IR 永远不变。 */
export function irQuery(
  client: RegistryClient,
  ns: string,
  name: string,
  release: Pick<ReleaseSummary, "label" | "visibility"> | undefined,
) {
  const label = release?.label ?? "";
  return queryOptions({
    queryKey: keys.ir(ns, name, label),
    queryFn: () => client.getIR(ns, name, label, { private: release?.visibility === "private" }),
    enabled: !!release,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * yank、改设置之后刷新作品数据。IR 不会变，不重新下载；详情、Release 详情、依赖者等都重读。
 */
export function refreshCreation(qc: QueryClient, ns: string, name: string): Promise<void> {
  return qc.invalidateQueries({
    queryKey: keys.creation(ns, name),
    predicate: (q) => q.queryKey[3] !== "ir",
  });
}

/** 没有指定版本时显示哪个：最新的 public Release，其次最新的可用版本，最后最新的任何版本。 */
export function defaultLabel(detail: CreationDetail): string | undefined {
  return (
    detail.latest_release?.label ??
    detail.releases.find((r) => r.status === "active")?.label ??
    detail.releases[0]?.label
  );
}

/** 账号开启了成人内容，并且记录了满 18 岁的确认时间；缺一项都仍然遮挡。 */
export function allowsMature(me: Me | null | undefined): boolean {
  return !!me?.settings.show_mature && !!me.settings.mature_confirmed_at;
}

export interface CreationState {
  ns: string;
  name: string;
  detail: CreationDetail;
  me: Me | null;
  /** 当前用户是这个 namespace 的成员（可以编辑、yank、改设置）。 */
  isOwner: boolean;
  allowMature: boolean;
  /** URL 里的 `v`；标签页之间切换时原样带上。 */
  v: string | undefined;
  /** 正在看的版本：`v`，没有时取 `defaultLabel`。 */
  label: string | undefined;
  /** `label` 对应的版本；`v` 写了一个不存在的版本时为 undefined。 */
  selected: ReleaseSummary | undefined;
  release: ReleaseDetail | undefined;
  /** 所选版本已被移除（410）时的公开原因代码。 */
  tombstoned: { reason: string } | null;
  ir: ContextIR | undefined;
  irState: "loading" | "ready" | "error" | "none";
  /** IR 加载失败后重试。 */
  retryIr: () => void;
  /** 所选版本的 effective rating：IR 里的值最准，其次 Release 与作品详情里的值。 */
  rating: Rating;
  /** 所选版本被 yank 时的公开理由（作者填写，可能没有）。 */
  yanked: { reason: string | undefined } | null;
}

const CreationContext = createContext<CreationState | null>(null);
export const CreationProvider = CreationContext.Provider;

/** 在作品外框里的标签页读取已加载的作品数据。 */
export function useCreation(): CreationState {
  const c = useContext(CreationContext);
  if (!c) throw new Error("useCreation() must be used inside the creation frame");
  return c;
}

export type CreationLoad =
  | { status: "pending" }
  | { status: "not-found" }
  | { status: "error"; error: unknown; retry: () => void }
  | { status: "ready"; state: CreationState };

/** 外框用的数据加载：作品详情、所选版本的 Release 详情与 Context IR。 */
export function useCreationLoad(ns: string, name: string, v: string | undefined): CreationLoad {
  const client = useRegistry();
  const me = useMe();
  const meId = me.data?.id ?? null;
  const detail = useQuery({
    ...creationDetailQuery(client, ns, name, meId),
    enabled: !me.isPending,
  });
  const d = detail.data;
  const label = v ?? (d ? defaultLabel(d) : undefined);
  const selected = d?.releases.find((r) => r.label === label);

  const release = useQuery({
    queryKey: keys.release(ns, name, label ?? ""),
    queryFn: () => client.release(ns, name, label ?? ""),
    enabled: !!selected,
  });
  const tombstoned = isApiError(release.error, "release.tombstoned")
    ? { reason: String(release.error.extra.reason ?? "unspecified") }
    : selected?.status === "tombstoned"
      ? { reason: selected.status_reason ?? "unspecified" }
      : null;
  const ir = useQuery({
    ...irQuery(client, ns, name, selected),
    enabled: !!selected && !tombstoned,
  });

  if (me.isPending || detail.isPending) return { status: "pending" };
  if (detail.isError) {
    if (isApiError(detail.error) && detail.error.status === 404) return { status: "not-found" };
    return { status: "error", error: detail.error, retry: () => void detail.refetch() };
  }
  const dd = detail.data;
  const rel = release.data;
  return {
    status: "ready",
    state: {
      ns,
      name,
      detail: dd,
      me: me.data ?? null,
      isOwner: !!me.data?.namespace && me.data.namespace === ns,
      allowMature: allowsMature(me.data),
      v,
      label,
      selected,
      release: rel,
      tombstoned,
      ir: ir.data,
      irState:
        !selected || tombstoned ? "none" : ir.data ? "ready" : ir.isError ? "error" : "loading",
      retryIr: () => void ir.refetch(),
      rating:
        ir.data?.meta.rating ??
        rel?.effective_rating ??
        selected?.effective_rating ??
        dd.effective_rating ??
        dd.rating,
      yanked: selected?.status === "yanked" ? { reason: selected.status_reason } : null,
    },
  };
}

/**
 * 依赖的版本号：IR 只记录锁定的 Release ID，版本号要从各个依赖的作品详情里查。返回
 * Release ID → label；查不到（请求失败、看不到）的不在里面，界面退回显示 ID。
 */
export function useReleaseLabels(refs: readonly string[]): ReadonlyMap<string, string> {
  const client = useRegistry();
  const me = useMe();
  const results = useQueries({
    queries: refs.map((ref) => {
      const r = parseRef(ref);
      return {
        ...creationDetailQuery(client, r?.ns ?? "", r?.name ?? "", me.data?.id),
        enabled: !!r && !me.isPending,
        retry: false,
      };
    }),
  });
  const labels = new Map<string, string>();
  for (const q of results) {
    for (const rel of q.data?.releases ?? []) labels.set(rel.id, rel.label);
  }
  return labels;
}
