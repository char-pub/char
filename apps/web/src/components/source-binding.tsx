/**
 * 作品设置里的“从 GitHub 发布”：显示绑定的仓库和状态。
 *
 * - active：按 tracked ref 和 publish refs 自动发布，可以解绑。
 * - frozen：仓库换了主人（被转移），发布暂停，等作者确认继续用这个仓库（rebind）或解绑。
 *   GitHub App 已经访问不到这个仓库时 rebind 会失败，这时只能解绑。
 * - 没有绑定：引导安装 App，按仓库地址查询并验证写权限，再选择源码路径与发布 refs。
 *   安装 ID 和仓库 ID 由服务端返回，不要求用户手填。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, Link2, Pause, Unlink } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { isApiError, type SourceBinding } from "@/lib/api";
import { isReadOnlyError } from "@/lib/read-only";
import { keys, useRegistry } from "@/lib/registry";
import { formatDate } from "@/lib/text";
import { cn } from "@/lib/utils";
import { FactCard } from "./creation-facts";
import { SourceConnect } from "./source-connect";
import { UserText } from "./user-content";

export const sourceBindingKey = (ns: string, name: string) =>
  [...keys.creation(ns, name), "source-binding"] as const;

function bindingError(e: unknown): string {
  if (isApiError(e, "github.repository_not_accessible")) {
    return "GitHub no longer lets char.pub read this repository, so it can't be kept. Unbind it instead.";
  }
  if (isReadOnlyError(e)) return "char.pub is read-only for maintenance. Try again later.";
  return "That didn't work. Try again.";
}

function Refs({ b }: { b: SourceBinding }) {
  return (
    <p className="font-mono text-xs break-all text-text-3">
      tracks {b.tracked_ref}
      {b.publish_refs.length > 0 ? ` · publishes ${b.publish_refs.join(", ")}` : ""}
      {b.path ? ` · ${b.path}` : ""}
    </p>
  );
}

export function SourceBindingSettings({ ns, name }: { ns: string; name: string }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const binding = useQuery({
    queryKey: sourceBindingKey(ns, name),
    queryFn: () => client.sourceBinding(ns, name),
  });
  const b = binding.data;
  const frozen = b?.status === "frozen";

  const run = async (what: "rebind" | "unbind") => {
    setBusy(true);
    setError(null);
    try {
      if (what === "rebind") await client.resolveSourceBinding(ns, name, "rebind");
      else if (frozen) await client.resolveSourceBinding(ns, name, "unbind");
      else await client.unbindSource(ns, name);
      await qc.invalidateQueries({ queryKey: sourceBindingKey(ns, name) });
      toast.success(what === "rebind" ? "Publishing from GitHub resumed" : "Repository unbound");
      setConfirm(false);
    } catch (e) {
      setError(bindingError(e));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FactCard id="settings-github" title="Publish from GitHub" className="space-y-4 px-6 py-5">
      <p className="-mt-2 text-sm text-text-2">
        Releases are created from tags in a repository you own. You can keep editing here too.
      </p>
      {binding.isPending ? (
        <Skeleton role="status" aria-label="Loading the repository" className="h-20 rounded-lg" />
      ) : binding.isError ? (
        <p role="alert" className="text-sm text-danger">
          The repository settings could not be loaded.{" "}
          <Button variant="link" size="sm" onClick={() => void binding.refetch()}>
            Try again
          </Button>
        </p>
      ) : !b || b.status === "unbound" ? (
        <SourceConnect
          ns={ns}
          name={name}
          onConnected={async () => {
            await qc.invalidateQueries({ queryKey: sourceBindingKey(ns, name) });
            toast.success("Repository connected");
          }}
        />
      ) : (
        <>
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg px-4 py-3",
              frozen ? "bg-warning-soft" : "bg-surface-2",
            )}
          >
            <FolderGit2 aria-hidden className="mt-0.5 size-5 shrink-0 text-text-2" />
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium break-all">{b.full_name}</span>
                {frozen ? (
                  <Badge variant="warning">
                    <Pause aria-hidden /> Paused
                  </Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </p>
              {frozen ? (
                <p className="text-sm">
                  <UserText
                    text={
                      b.frozen_reason ??
                      "The repository moved to a new owner, so publishing is paused until you confirm."
                    }
                  />
                </p>
              ) : null}
              <Refs b={b} />
              {b.last_checked_at ? (
                <p className="text-xs text-text-3">Last checked {formatDate(b.last_checked_at)}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {frozen ? (
              <Button variant="ink" disabled={busy} onClick={() => void run("rebind")}>
                <Link2 aria-hidden /> Keep this repository
              </Button>
            ) : null}
            <Button variant="destructive" disabled={busy} onClick={() => setConfirm(true)}>
              <Unlink aria-hidden /> Unbind
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <AlertDialog open={confirm} onOpenChange={(o) => !busy && setConfirm(o)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unbind {b.full_name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  New tags in the repository won't publish releases any more. Releases that are
                  already published stay as they are.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive-solid"
                  disabled={busy}
                  onClick={() => void run("unbind")}
                >
                  <Unlink aria-hidden /> {busy ? "Unbinding…" : "Unbind"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </FactCard>
  );
}
