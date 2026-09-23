/**
 * 依赖：这个作品建立在哪些已发布的作品之上（例如角色所在的世界）。每个依赖都锁定到
 * 一个精确的 Release（Release ID + semantic digest），上游之后的更新不会悄悄改变它。
 *
 * 每一行显示依赖的类型颜色、关系词、ref、锁定的版本和用法（Core / Recommended），版本和用法
 * 可以直接改；新依赖通过下方的搜索添加。
 */
import type { CheckDiagnostic, ReferenceEdge } from "@char-pub/core";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { getReferences, nextId, setReferences, type Working } from "@/lib/draft";
import { parseRef } from "@/lib/text";
import {
  DependencyPicker,
  lookupError,
  MODE_LABEL,
  TypeDot,
  useDependencyDetail,
} from "./dependency-picker";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";

/** 关系词的展示形式：`lives_in` → “lives in”，没有写时是 “uses”。 */
export function relText(r: ReferenceEdge): string {
  return r.rel ? r.rel.replace(/_/g, " ") : "uses";
}

/** 折叠时的一行摘要，例如 “Lives in @cyberpunk/night-city · knows about @cyberpunk/corps”。 */
export function dependenciesSummary(w: Working): string {
  const refs = getReferences(w);
  if (refs.length === 0) return "None yet — build on a world or a lorebook";
  const text = refs.map((r) => `${relText(r)} ${String(r.use)}`).join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const FOLLOW = "follow";

function DependencyRow({
  edge,
  onChange,
  onRemove,
  diagnostics,
}: {
  edge: ReferenceEdge;
  onChange: (next: ReferenceEdge) => void;
  onRemove: () => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const use = String(edge.use);
  const target = parseRef(use);
  const detail = useDependencyDetail(target);
  const releases = detail.data?.releases ?? [];
  const pinned = edge.pin && "release" in edge.pin ? edge.pin.release : null;
  const current = releases.find((r) => r.id === pinned);
  // 可选的版本：可用的 Release，加上当前锁定的那个（即使它后来被 yank 了）。
  const options = releases.filter((r) => r.status === "active" || r.id === pinned);
  const value = pinned ?? (edge.pin ? FOLLOW : "");

  return (
    <li className="space-y-1.5 rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TypeDot type={detail.data?.type} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-sm text-text-2">{relText(edge)}</span>
          <span className="truncate font-mono text-sm">{use}</span>
        </span>
        <NativeSelect
          size="sm"
          className="w-32 font-mono sm:w-36"
          aria-label={`Version of ${use}`}
          value={value}
          disabled={!detail.data}
          onChange={(e) => {
            const r = releases.find((x) => x.id === e.target.value);
            if (r)
              onChange({ ...edge, pin: { release: r.id, semantic_digest: r.semantic_digest } });
          }}
        >
          {value === "" ? <option value="">Pick a version</option> : null}
          {value === FOLLOW ? <option value={FOLLOW}>latest</option> : null}
          {pinned && !current ? <option value={pinned}>locked</option> : null}
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {r.status === "yanked" ? " (yanked)" : ""}
              {r.visibility === "private" ? " (private)" : ""}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          size="sm"
          className="w-40"
          aria-label={`How ${use} is used`}
          value={edge.mode}
          onChange={(e) => onChange({ ...edge, mode: e.target.value as ReferenceEdge["mode"] })}
        >
          <option value="intrinsic">{MODE_LABEL.intrinsic}</option>
          <option value="default">{MODE_LABEL.default}</option>
        </NativeSelect>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${use}`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>
      {detail.isError ? <p className="text-xs text-danger">{lookupError(detail.error)}</p> : null}
      {current?.status === "yanked" ? (
        <p className="text-xs text-warning">
          This version was yanked{current.status_reason ? `: ${current.status_reason}` : ""}. It
          still works, but pick another one if you can.
        </p>
      ) : null}
      {value === FOLLOW ? (
        <p className="text-xs text-text-2">Follows the latest release until you publish.</p>
      ) : null}
      <DiagnosticList items={diagnostics} />
    </li>
  );
}

export function DependenciesEditor({
  self,
  working,
  update,
  diagnostics,
}: {
  /** 自己的 ref（`@ns/name`），搜索结果里不出现。 */
  self: string;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const refs = getReferences(working);
  const replace = (i: number, next: ReferenceEdge | null) =>
    update((w) => {
      const list = [...getReferences(w)];
      if (next) list[i] = next;
      else list.splice(i, 1);
      return setReferences(w, list);
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-2">
        Build on published creations: the world your character lives in, a shared lorebook. Each
        dependency is locked to an exact release, so later changes upstream never reach you by
        surprise.
      </p>
      {refs.length > 0 ? (
        <ul className="space-y-2" aria-label="Dependencies">
          {refs.map((r, i) => (
            <DependencyRow
              key={r.id}
              edge={r}
              onChange={(next) => replace(i, next)}
              onRemove={() => replace(i, null)}
              diagnostics={diagnosticsFor(diagnostics, `references[${r.id}]`, String(r.use))}
            />
          ))}
        </ul>
      ) : null}
      <DependencyPicker
        self={self}
        taken={refs.map((r) => String(r.use))}
        onAdd={(edge, base) =>
          update((w) => {
            const list = getReferences(w);
            const id = nextId(
              list.map((r) => r.id),
              base.slice(0, 64),
            );
            return setReferences(w, [...list, { id, ...edge }]);
          })
        }
      />
    </div>
  );
}
