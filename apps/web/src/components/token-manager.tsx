/**
 * 个人 Token：给 CLI 与自动化使用。明文只在创建后显示一次，之后只能看到前缀。
 * Token 不能用来管理 Token 或修改账号设置，这些操作只能在浏览器里完成。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreatedToken, TokenScope } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { formatDate } from "@/lib/text";

const SCOPES: { id: TokenScope; label: string }[] = [
  { id: "creations:read", label: "Read your creations and drafts" },
  { id: "creations:write", label: "Edit drafts" },
  { id: "releases:publish", label: "Publish releases" },
  { id: "contributions:write", label: "Open contributions" },
];

export function TokenManager() {
  const client = useRegistry();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["me", "tokens"], queryFn: () => client.tokens() });
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [scopes, setScopes] = useState<TokenScope[]>(["creations:read"]);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const ids = { name: useId(), days: useId() };

  const create = useMutation({
    mutationFn: () => client.createToken({ name: name.trim(), scopes, expires_in_days: days }),
    onSuccess: (t) => {
      setCreated(t);
      setName("");
      void qc.invalidateQueries({ queryKey: ["me", "tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => client.revokeToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "tokens"] }),
  });

  return (
    <div className="space-y-5">
      {created ? (
        <div role="status" className="catalog-card space-y-2 p-4 pl-8">
          <p className="text-sm">
            Copy this token now. It will not be shown again; it expires{" "}
            {formatDate(created.expires_at)}.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-xs bg-muted px-2 py-1 font-mono text-xs">
              {created.token}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(created.token)}
            >
              <Copy aria-hidden /> Copy
            </Button>
          </div>
          <button type="button" className="text-xs underline" onClick={() => setCreated(null)}>
            I have saved it
          </button>
        </div>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && scopes.length > 0) create.mutate();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.name} className="text-sm">
            Token name
          </label>
          <Input
            id={ids.name}
            value={name}
            maxLength={100}
            placeholder="e.g. laptop CLI"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.days} className="text-sm">
            Expires in (days)
          </label>
          <Input
            id={ids.days}
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
          />
        </div>
        <Button type="submit" disabled={!name.trim() || scopes.length === 0 || create.isPending}>
          Create token
        </Button>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-1 sm:col-span-3">
          <legend className="sr-only">Scopes</legend>
          {SCOPES.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[var(--seal)]"
                checked={scopes.includes(s.id)}
                onChange={(e) =>
                  setScopes((prev) =>
                    e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                  )
                }
              />
              {s.label} <code className="font-mono text-xs text-muted-foreground">{s.id}</code>
            </label>
          ))}
        </fieldset>
      </form>
      {create.isError ? (
        <p role="alert" className="text-sm text-seal">
          Could not create the token. Check the name and scopes and try again.
        </p>
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {list.data.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="block text-sm">{t.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t.prefix}… · {t.scopes.join(", ")}
                  {t.expires_at ? ` · expires ${formatDate(t.expires_at)}` : ""}
                  {t.last_used_at ? ` · last used ${formatDate(t.last_used_at)}` : " · never used"}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(t.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : list.isSuccess ? (
        <p className="text-sm text-muted-foreground">You have no active tokens.</p>
      ) : null}
    </div>
  );
}
