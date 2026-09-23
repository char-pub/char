import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError, type RepositoryChoice } from "@/lib/api";
import { linkSignInMethod } from "@/lib/auth";
import { useRegistry } from "@/lib/registry";

export function SourceConnect({
  ns,
  name,
  onConnected,
}: {
  ns: string;
  name: string;
  onConnected: () => Promise<void>;
}) {
  const id = useId();
  const client = useRegistry();
  const [repository, setRepository] = useState("");
  const [choice, setChoice] = useState<RepositoryChoice | null>(null);
  const [path, setPath] = useState("char.yaml");
  const [branch, setBranch] = useState("main");
  const [refs, setRefs] = useState("refs/tags/*");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = useQuery({
    queryKey: ["github-connection", ns, name],
    queryFn: () => client.githubConnection(ns, name),
    retry: false,
  });
  const failure = (e: unknown) =>
    setError(
      isApiError(e) && e.status === 404
        ? "Repository unavailable. Install the app on that repository and make sure your linked GitHub account has write access."
        : isApiError(e, "github.installation_unavailable")
          ? "The installation is still being registered. Wait a moment and retry."
          : isApiError(e, "github.repository_forbidden")
            ? "Your linked GitHub account needs write access to this repository."
            : "The connection could not be completed. Check the repository, path and refs, then try again.",
    );
  const lookup = async () => {
    setBusy(true);
    setError(null);
    setChoice(null);
    try {
      const full = repository
        .trim()
        .replace(/^https:\/\/github.com\//, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
      const result = await client.lookupRepository(ns, name, full);
      setChoice(result);
      setBranch(result.default_branch);
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };
  const bind = async () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await client.bindSource(ns, name, {
        repository_id: choice.id,
        installation_id: choice.installation_id,
        path: path.trim(),
        tracked_ref: `refs/heads/${branch.trim()}`,
        publish_refs: refs
          .split(/[\n,]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
      await onConnected();
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };
  if (config.isPending) return <p role="status">Loading GitHub connection…</p>;
  if (config.isError)
    return (
      <p role="alert">
        GitHub connection is unavailable.{" "}
        <Button variant="link" onClick={() => void config.refetch()}>
          Try again
        </Button>
      </p>
    );
  return (
    <div className="space-y-4 rounded-lg border p-4">
      {!config.data.linked ? (
        <div className="space-y-2">
          <p className="text-sm">Link your GitHub identity before connecting a repository.</p>
          <Button
            variant="outline"
            onClick={() => void linkSignInMethod("github", window.location.pathname).catch(failure)}
          >
            Link GitHub account
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-text-2">
            Install the char.pub app on your repository, then return here. Your linked GitHub
            account must have write access.
          </p>
          <Button variant="outline" asChild>
            <a href={config.data.installation_url} target="_blank" rel="noopener noreferrer">
              Install or configure GitHub App ↗
            </a>
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label
              htmlFor={`${id}-repository`}
              className="min-w-0 flex-1 space-y-1 text-sm font-medium"
            >
              Repository
              <Input
                id={`${id}-repository`}
                value={repository}
                placeholder="owner/repository or GitHub URL"
                disabled={busy}
                onChange={(e) => {
                  setRepository(e.target.value);
                  setChoice(null);
                }}
                required
              />
            </label>
            <Button variant="outline" disabled={busy || !repository.trim()}>
              Find repository
            </Button>
          </form>
          {choice ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void bind();
              }}
              className="space-y-3"
            >
              <p className="font-mono text-sm">{choice.full_name}</p>
              <label htmlFor={`${id}-path`} className="block space-y-1 text-sm font-medium">
                Source file
                <Input
                  id={`${id}-path`}
                  value={path}
                  disabled={busy}
                  onChange={(e) => setPath(e.target.value)}
                  required
                />
              </label>
              <label htmlFor={`${id}-branch`} className="block space-y-1 text-sm font-medium">
                Tracked branch
                <Input
                  id={`${id}-branch`}
                  value={branch}
                  disabled={busy}
                  onChange={(e) => setBranch(e.target.value)}
                  required
                />
              </label>
              <label htmlFor={`${id}-refs`} className="block space-y-1 text-sm font-medium">
                Allowed publishing refs
                <Input
                  id={`${id}-refs`}
                  value={refs}
                  disabled={busy}
                  onChange={(e) => setRefs(e.target.value)}
                  required
                />
              </label>
              <p className="text-xs text-text-2">
                Separate refs with commas, for example refs/heads/main, refs/tags/*. Tags are
                allowed by default.
              </p>
              <Button disabled={busy || !path.trim() || !branch.trim() || !refs.trim()}>
                {busy ? "Connecting…" : "Connect repository"}
              </Button>
            </form>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
