/**
 * 给个人 namespace 改名。旧名永久重定向到新名（旧链接继续可用），别人也不能再注册旧名；
 * 新名已被占用或是保留名时服务端拒绝，这里按错误码说明。
 */
import { NAMESPACE_RE } from "@char-pub/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";

const ERRORS: Record<string, string> = {
  "namespace.taken": "That name is already taken.",
  "namespace.reserved": "That name is reserved. Pick another one.",
  "request.invalid": "Use lowercase letters, digits and hyphens.",
  rate_limited: "You've renamed recently. Wait a while and try again.",
  forbidden: "Only the owner of this namespace can rename it.",
  "token.not_allowed": "Renaming can only be done in the browser.",
  "feature.disabled": "Renaming is paused at the moment.",
  "feature.read_only": "char.pub is in read-only mode right now. Try again later.",
};

export function RenameNamespaceDialog({ current }: { current: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const ids = { input: useId(), help: useId() };
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(current);
  const valid = NAMESPACE_RE.test(slug) && slug !== current;
  const rename = useMutation({
    mutationFn: () => client.renameNamespace(current, slug),
    onSuccess: async (ns) => {
      setOpen(false);
      toast.success(`You're now @${ns.slug}`, {
        description: `Links to @${current} keep working.`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.me }),
        qc.invalidateQueries({ queryKey: keys.myCreations }),
      ]);
    },
  });
  const error = rename.error
    ? (isApiError(rename.error) && ERRORS[rename.error.code]) ||
      "The name could not be changed. Try again."
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setSlug(current);
          rename.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Pencil aria-hidden /> Rename…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) rename.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename @{current}</DialogTitle>
            <DialogDescription>
              Old links to <span className="font-mono">@{current}/…</span> keep working and redirect
              to the new name. Nobody else can register{" "}
              <span className="font-mono">@{current}</span> afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={ids.input} className="block text-sm font-semibold">
              New name
            </label>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="font-mono text-text-3">
                @
              </span>
              <Input
                id={ids.input}
                value={slug}
                maxLength={39}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                aria-describedby={ids.help}
                aria-invalid={(slug !== "" && !NAMESPACE_RE.test(slug)) || !!error}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  if (rename.isError) rename.reset();
                }}
              />
            </div>
            <p id={ids.help} className="text-xs text-text-3">
              Lowercase letters, digits and hyphens.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || rename.isPending}>
              Rename to @{slug || "…"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
