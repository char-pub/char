/**
 * 作品地址输入：固定的 `@namespace/` 前缀加可编辑的 slug，右侧和下方显示格式与是否可用。
 *
 * 是否可用靠读一次这个地址：404 就是没人用（看不到的 private 作品也是 404，最终仍以创建时
 * 服务端的 `creation.taken` / `import.name_taken` 为准）。输入停下 400ms 后才查，避免每敲一个
 * 字就发请求。
 */
import { NAME_RE } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fieldClass } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";

export type Availability = "invalid" | "checking" | "available" | "taken" | "unknown";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useNameAvailability(ns: string, slug: string, enabled = true): Availability {
  const client = useRegistry();
  const debounced = useDebounced(slug, 400);
  const valid = NAME_RE.test(slug);
  const check = useQuery({
    queryKey: ["name-check", ns, debounced],
    queryFn: async () => {
      try {
        await client.creation(ns, debounced);
        return "taken" as const;
      } catch (e) {
        if (isApiError(e) && e.status === 404) return "available" as const;
        throw e;
      }
    },
    enabled: enabled && valid && debounced === slug,
    retry: false,
    staleTime: 30_000,
  });
  if (!valid) return "invalid";
  if (debounced !== slug || check.isPending) return enabled ? "checking" : "unknown";
  if (check.isError) return "unknown";
  return check.data;
}

const HINT: Record<Availability, string> = {
  invalid: "Use lowercase letters, digits and hyphens; start and end with a letter or digit.",
  checking: "Lowercase letters, digits and hyphens. Checking…",
  available: "Lowercase letters, digits and hyphens. Available.",
  taken: "Already used in this namespace. Choose another address.",
  unknown: "Lowercase letters, digits and hyphens.",
};

export function AddressField({
  id,
  ns,
  value,
  onChange,
  availability,
  hintId,
}: {
  id: string;
  ns: string;
  value: string;
  onChange: (next: string) => void;
  availability: Availability;
  hintId: string;
}) {
  const bad = value !== "" && (availability === "invalid" || availability === "taken");
  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          fieldClass,
          "flex h-9 items-stretch overflow-hidden p-0 font-mono has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/25",
          bad && "border-danger",
        )}
      >
        <span className="flex shrink-0 items-center border-r bg-surface-2 px-3 text-text-3">
          @{ns}/
        </span>
        <input
          id={id}
          value={value}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={bad}
          aria-describedby={hintId}
          className="min-w-0 flex-1 bg-transparent px-3 outline-none"
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <span className="flex shrink-0 items-center pr-3" aria-hidden>
          {availability === "checking" ? (
            <Loader2 className="size-4 animate-spin text-text-3" />
          ) : availability === "available" ? (
            <Check className="size-4 text-success" />
          ) : bad ? (
            <X className="size-4 text-danger" />
          ) : null}
        </span>
      </div>
      <p
        id={hintId}
        className={cn(
          "text-xs",
          availability === "available" ? "text-success" : bad ? "text-danger" : "text-text-3",
        )}
      >
        {value === "" ? "Pick an address for the link." : HINT[availability]}
      </p>
    </div>
  );
}
