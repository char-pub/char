import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Editor } from "@/components/editor/editor";
import { Container } from "@/components/layout";
import { SignInRequired } from "@/components/sign-in-required";
import { PageSkeleton } from "@/components/skeletons";
import { ErrorState, StatePanel } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { isApiError } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";

export const Route = createFileRoute("/c/$ns/$name_/edit")({
  // 编辑器是整页工作区：编辑栏通栏，内容区自己用 Container 对齐。
  staticData: { fullBleed: true },
  component: EditRoute,
});

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

  if (me.isPending) {
    return (
      <Container className="py-10">
        <PageSkeleton label="Loading the editor" />
      </Container>
    );
  }
  if (!me.data) {
    return (
      <Container className="py-10">
        <SignInRequired what="edit this creation" />
      </Container>
    );
  }
  if (detail.isPending || draft.isPending) {
    return (
      <Container className="py-10">
        <PageSkeleton label="Loading the draft" />
      </Container>
    );
  }
  if (detail.isError || draft.isError) {
    const e = detail.error ?? draft.error;
    return (
      <Container className="py-10">
        {isApiError(e) && (e.status === 404 || e.status === 403) ? (
          <StatePanel
            level={1}
            code="404"
            title="You can't edit this creation"
            description={
              <>
                Only members of <span className="font-mono">@{ns}</span> can edit its drafts, or the
                address is wrong.
              </>
            }
            className="mx-auto max-w-xl"
          >
            <Link to="/me" className={buttonVariants({ variant: "outline" })}>
              Go to your creations
            </Link>
          </StatePanel>
        ) : (
          <ErrorState
            level={1}
            title="The draft could not be loaded"
            error={e}
            onRetry={() => {
              void detail.refetch();
              void draft.refetch();
            }}
            className="mx-auto max-w-xl"
          />
        )}
      </Container>
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
      releases={detail.data.releases}
      latestPublicLabel={detail.data.latest_release?.label}
    />
  );
}
