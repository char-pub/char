/**
 * 第一次创作前注册个人 namespace（作品地址 `@namespace/name` 的前半部分）。
 * 每个账号只能有一个个人 namespace；保留名与已被占用的名字由服务端拒绝。以后可以在设置里
 * 改名，旧地址会一直跳转到新名字，所以这里不需要一次想好。
 */
import { NAMESPACE_RE } from "@char-pub/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";
import { cn } from "@/lib/utils";

/** 服务端拒绝时的说明；`slug` 是提交时的名字。 */
function errorText(e: unknown, slug: string): string {
  if (isApiError(e, "namespace.taken")) return `@${slug} is already taken. Try another name.`;
  if (isApiError(e, "namespace.reserved")) return `@${slug} is reserved. Try another name.`;
  if (isApiError(e, "namespace.limit")) {
    return "Your account already has a personal @name. Reload the page to continue with it.";
  }
  return "Could not register the name. Try again.";
}

export function NamespaceSetup({ suggestion }: { suggestion: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [slug, setSlug] = useState(() => slugify(suggestion, 39));
  const id = useId();
  const valid = NAMESPACE_RE.test(slug);
  const create = useMutation({
    mutationFn: (s: string) => client.createNamespace(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
  // 改了名字之后旧的错误就不再适用。
  const error =
    create.error && create.variables === slug ? errorText(create.error, create.variables) : null;
  const formatError =
    slug !== "" && !valid
      ? "Use up to 39 lowercase letters, digits and hyphens; start and end with a letter or digit."
      : null;
  const message = error ?? formatError;

  return (
    <section
      aria-labelledby={`${id}-h`}
      className="mx-auto w-full max-w-xl space-y-5 rounded-lg border bg-surface p-6"
    >
      <div className="space-y-2">
        <h2 id={`${id}-h`} className="text-xl font-bold tracking-tight">
          First, choose your name on char.pub
        </h2>
        <p className="text-sm text-text-2">
          It's the start of every address you publish, like{" "}
          <span className="font-mono text-text">@{slug || "rin"}/alice</span>. You can rename it
          later in Settings; old links keep working.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate(slug);
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Namespace
          </label>
          <div
            className={cn(
              fieldClass,
              "flex h-9 items-stretch overflow-hidden p-0 font-mono has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/25",
              message && "border-danger",
            )}
          >
            <span className="flex items-center border-r bg-surface-2 px-3 text-text-3">@</span>
            <input
              id={id}
              value={slug}
              maxLength={39}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!message}
              aria-describedby={message ? `${id}-err` : undefined}
              className="min-w-0 flex-1 bg-transparent px-3 outline-none"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </div>
          {message ? (
            <p id={`${id}-err`} role="alert" className="text-xs text-danger">
              {message}
            </p>
          ) : (
            <p className="text-xs text-text-3">Lowercase letters, digits and hyphens.</p>
          )}
        </div>
        <Button type="submit" disabled={!valid || create.isPending}>
          <AtSign aria-hidden /> Register @{slug || "name"}
        </Button>
      </form>
    </section>
  );
}
