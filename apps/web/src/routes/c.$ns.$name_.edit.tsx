import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Editor } from "@/components/editor/editor";
import { SignInRequired } from "@/components/sign-in-required";
import { isApiError } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";

export const Route = createFileRoute("/c/$ns/$name_/edit")({ component: EditRoute });

function EditRoute() {
  const { ns, name } = Route.useParams();
  const client = useRegistry();
  const me = useMe();
  const signedIn = !!me.data;
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: signedIn,
  });
  const draft = useQuery({
    queryKey: keys.draft(ns, name),
    queryFn: () => client.draft(ns, name),
    enabled: signedIn,
    // 编辑器自己管理草稿状态：不在后台重新读取，避免覆盖正在编辑的内容。
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });

  if (me.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!me.data) return <SignInRequired what="edit this creation" />;
  if (detail.isPending || draft.isPending) {
    return <p className="text-muted-foreground">Loading the draft…</p>;
  }
  if (detail.isError || draft.isError) {
    const e = detail.error ?? draft.error;
    return (
      <section className="space-y-3 py-10">
        <h1 className="text-3xl">
          {isApiError(e) && e.status === 404
            ? "You can't edit this creation."
            : "The draft could not be loaded."}
        </h1>
        <p className="text-muted-foreground">
          Only members of <span className="font-mono">@{ns}</span> can edit its drafts.{" "}
          <Link to="/me" className="underline">
            Go to your creations
          </Link>
        </p>
      </section>
    );
  }

  return (
    <Editor
      // 重新进入页面时从服务端的最新版本开始。
      key={`${ns}/${name}@${draft.data.version}`}
      ns={ns}
      name={name}
      type={detail.data.type}
      draft={draft.data}
      existingLabels={detail.data.releases.map((r) => r.label)}
    />
  );
}
