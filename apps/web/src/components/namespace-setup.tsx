/**
 * 第一次创作前注册个人 namespace（作品地址 `@namespace/name` 的前半部分）。
 * 每个账号只能有一个个人 namespace；保留名与已被占用的名字由服务端拒绝。
 */
import { NAMESPACE_RE } from "@char-pub/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";
import { slugify } from "@/lib/text";

const ERRORS: Record<string, string> = {
  "namespace.taken": "That name is already taken.",
  "namespace.reserved": "That name is reserved. Pick another one.",
  "namespace.limit": "Your account already has a personal namespace.",
};

export function NamespaceSetup({ suggestion }: { suggestion: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [slug, setSlug] = useState(() => slugify(suggestion, 39));
  const id = useId();
  const valid = NAMESPACE_RE.test(slug);
  const create = useMutation({
    mutationFn: () => client.createNamespace(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
  const error = create.error
    ? ((isApiError(create.error) && ERRORS[create.error.code]) ??
      "Could not register the name. Try again.")
    : null;

  return (
    <section className="catalog-card max-w-xl space-y-4 p-6 pl-8" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="font-display text-2xl">
        First, choose your name on char.pub
      </h2>
      <p className="text-sm text-muted-foreground">
        Your creations live under <span className="font-mono">@name/…</span>. Use lowercase letters,
        digits and hyphens. You can rename it later; old links keep working.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor={id} className="text-sm">
            Namespace
          </label>
          <div className="flex items-center gap-1">
            <span className="font-mono text-muted-foreground">@</span>
            <Input
              id={id}
              value={slug}
              maxLength={39}
              autoComplete="off"
              aria-invalid={slug !== "" && !valid}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </div>
        </div>
        <Button type="submit" disabled={!valid || create.isPending}>
          Register @{slug || "name"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </section>
  );
}
