/**
 * 个人 Token：给 CLI、CI 与 Agent 使用。明文只在创建后显示一次，之后只能看到前缀。
 * Token 不能用来管理 Token 或修改账号设置，这些操作只能在浏览器里完成。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { useId, useState } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { EmptyState, ErrorState } from "@/components/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { CreatedToken, PersonalToken, TokenScope } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { formatDate, timeAgo } from "@/lib/text";

const SCOPES: { id: TokenScope; label: string }[] = [
  { id: "creations:read", label: "Read your creations and drafts" },
  { id: "creations:write", label: "Edit drafts" },
  { id: "releases:publish", label: "Publish releases" },
  { id: "contributions:write", label: "Open contributions" },
];

const TOKENS_KEY = ["me", "tokens"] as const;

function TokenRow({ token, onRevoke }: { token: PersonalToken; onRevoke: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold break-words">{token.name}</span>
          <span className="font-mono text-xs text-text-3">{token.prefix}…</span>
        </p>
        <p className="font-mono text-xs break-words text-text-2">{token.scopes.join(" · ")}</p>
      </div>
      <p className="text-xs text-text-3">
        {token.expires_at ? `Expires ${formatDate(token.expires_at)}` : "Never expires"} ·{" "}
        {token.last_used_at ? `Used ${timeAgo(token.last_used_at)}` : "Never used"}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-danger hover:bg-danger-soft hover:text-danger"
        aria-label={`Revoke ${token.name}`}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </li>
  );
}

/** 创建 Token 的表单；成功后换成只显示一次的明文。 */
function CreateTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const client = useRegistry();
  const qc = useQueryClient();
  const ids = { name: useId(), days: useId() };
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [scopes, setScopes] = useState<TokenScope[]>(["creations:read"]);
  const [created, setCreated] = useState<
    (CreatedToken & { name: string; scopes: string[] }) | null
  >(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => client.createToken({ name: name.trim(), scopes, expires_in_days: days }),
    onSuccess: (t) => {
      setCreated({ ...t, name: name.trim(), scopes: [...scopes] });
      void qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });

  // 关闭之后清掉明文和表单：明文只在这一次显示。
  const close = () => {
    onOpenChange(false);
    setCreated(null);
    setCopied(false);
    setName("");
    setDays(90);
    setScopes(["creations:read"]);
    create.reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
              <DialogDescription>Copy it now. You won't be able to see it again.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3">
              <code className="min-w-0 flex-1 font-mono text-xs break-all">{created.token}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(created.token).then(() => {
                    setCopied(true);
                    toast.success("Token copied");
                  });
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-text-3">Name</dt>
              <dd className="font-mono break-words">{created.name}</dd>
              <dt className="text-text-3">Scopes</dt>
              <dd className="font-mono break-words">{created.scopes.join(", ")}</dd>
              <dt className="text-text-3">Expires</dt>
              <dd className="font-mono">{formatDate(created.expires_at)}</dd>
            </dl>
            <DialogFooter>
              <Button type="button" variant="ink" onClick={close}>
                <Check aria-hidden /> I've saved it
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && scopes.length > 0) create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create a token</DialogTitle>
              <DialogDescription>
                The token acts as you, within the scopes you choose. It can't manage tokens or
                change your settings.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div className="space-y-1.5">
                <label htmlFor={ids.name} className="block text-sm font-semibold">
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
              <div className="space-y-1.5">
                <label htmlFor={ids.days} className="block text-sm font-semibold">
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
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">Scopes</legend>
              {SCOPES.map((s) => {
                const id = `${ids.name}-${s.id}`;
                return (
                  <div key={s.id} className="flex items-center gap-2.5">
                    <Checkbox
                      id={id}
                      checked={scopes.includes(s.id)}
                      onCheckedChange={(v) =>
                        setScopes((prev) =>
                          v === true ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                        )
                      }
                    />
                    <label htmlFor={id} className="text-sm">
                      {s.label} <code className="font-mono text-xs text-text-3">{s.id}</code>
                    </label>
                  </div>
                );
              })}
            </fieldset>
            {create.isError ? (
              <p role="alert" className="text-sm text-danger">
                Could not create the token. Check the name and scopes and try again.
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || scopes.length === 0 || create.isPending}
              >
                Create token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TokenManager() {
  const client = useRegistry();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: TOKENS_KEY, queryFn: () => client.tokens() });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<PersonalToken | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => client.revokeToken(id),
    onSuccess: async () => {
      toast.success("Token revoked");
      await qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });

  return (
    <div className="space-y-4">
      {list.isPending ? (
        <ListSkeleton rows={2} label="Loading your tokens…" />
      ) : list.isError ? (
        <ErrorState
          title="Your tokens could not be loaded"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="You have no active tokens"
          description="Create one for the char CLI, a CI job or an agent."
        />
      ) : (
        <ul aria-label="Tokens" className="divide-y divide-border rounded-lg border">
          {list.data.items.map((t) => (
            <TokenRow key={t.id} token={t} onRevoke={() => setRevoking(t)} />
          ))}
        </ul>
      )}
      {revoke.isError ? (
        <p role="alert" className="text-sm text-danger">
          The token could not be revoked. Try again.
        </p>
      ) : null}
      <Button type="button" variant="outline" onClick={() => setCreating(true)}>
        <Plus aria-hidden /> Create a token
      </Button>

      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
      <AlertDialog open={!!revoking} onOpenChange={(v) => (v ? null : setRevoking(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything that uses this token stops working right away. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive-solid"
              onClick={() => {
                if (revoking) revoke.mutate(revoking.id);
              }}
            >
              Revoke token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
