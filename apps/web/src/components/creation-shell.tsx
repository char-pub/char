/**
 * 作品外框：头部 + 标签页（Overview · Context preview · Versions · Contributions · Settings），
 * 下面渲染当前标签页。外框统一处理整页状态（加载骨架、404、加载失败），并替“显示某个版本内容”
 * 的标签页（路由上声明 `staticData: { creationVersioned: true }`）处理版本状态：版本不存在、
 * 还没有发布、已移除（410，显示公开原因），yanked 时在内容上方给出提示条。
 *
 * 标签页通过 `useCreation()` 读取已加载的数据（见 creation-context.tsx）。
 */
import { Link, useMatches } from "@tanstack/react-router";
import { History, PackageOpen, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { PageSkeleton } from "@/components/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { TabsNav, tabsTriggerVariants } from "@/components/ui/tabs";
import { CreationProvider, useCreation, useCreationLoad } from "./creation-context";
import { CreationHeader } from "./creation-header";
import { tombstoneText } from "./release-list";
import { EmptyState, ErrorState, NotFound, RemovedState } from "./states";
import { UserText } from "./user-content";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** 这个标签页显示所选版本的内容：外框替它处理版本不存在、未发布、已移除和 yanked。 */
    creationVersioned?: boolean;
  }
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-surface-2 px-1.5 text-xs leading-5 font-semibold text-text-2">
      {n}
    </span>
  );
}

function CreationTabs() {
  const { ns, name, v, detail, isOwner } = useCreation();
  const params = { ns, name };
  // 切换标签时保留正在看的版本。
  const search = v ? { v } : {};
  const tab = tabsTriggerVariants();
  const loose = { includeSearch: false };
  return (
    <TabsNav aria-label="Creation sections">
      <Link
        to="/c/$ns/$name"
        params={params}
        search={search}
        activeOptions={{ exact: true, includeSearch: false }}
        className={tab}
      >
        Overview
      </Link>
      <Link
        to="/c/$ns/$name/preview"
        params={params}
        search={search}
        activeOptions={loose}
        className={tab}
      >
        Context preview
      </Link>
      <Link
        to="/c/$ns/$name/versions"
        params={params}
        search={search}
        activeOptions={loose}
        className={tab}
      >
        Versions <Count n={detail.releases.length} />
      </Link>
      <Link
        to="/c/$ns/$name/contributions"
        params={params}
        search={search}
        activeOptions={loose}
        className={tab}
      >
        Contributions
      </Link>
      {isOwner ? (
        <Link
          to="/c/$ns/$name/settings"
          params={params}
          search={search}
          activeOptions={loose}
          className={tab}
        >
          Settings
        </Link>
      ) : null}
    </TabsNav>
  );
}

function YankedNotice({ label, reason }: { label: string; reason: string | undefined }) {
  const { ns, name } = useCreation();
  return (
    <div
      role="note"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-text"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">
          Version <span className="font-mono">{label}</span> was yanked
          {reason ? (
            <>
              : “<UserText text={reason} />”
            </>
          ) : null}
        </p>
        <p className="text-text-2">
          Creations that already lock this version keep working, but new work should use another
          one.
        </p>
      </div>
      <Link
        to="/c/$ns/$name/versions"
        params={{ ns, name }}
        className="text-sm font-semibold text-blue-text underline-offset-4 hover:underline"
      >
        See versions
      </Link>
    </div>
  );
}

/** 显示某个版本内容的标签页外面这一层：版本状态不对时替它显示对应的说明。 */
function VersionState({ children }: { children: ReactNode }) {
  const c = useCreation();
  const { ns, name } = c;
  const versions = (
    <Link
      to="/c/$ns/$name/versions"
      params={{ ns, name }}
      className={buttonVariants({ variant: "outline" })}
    >
      <History aria-hidden /> See other versions
    </Link>
  );
  if (c.v && !c.selected) {
    return (
      <NotFound
        level={2}
        what={`${c.detail.ref}@${c.v}`}
        description="There is no version with this label, or it isn't public."
      />
    );
  }
  if (!c.selected || !c.label) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No release yet"
        description={
          c.isOwner
            ? "Publish a release from the editor. Its content, context preview and downloads show up here."
            : "The author hasn't published a version of this creation yet."
        }
        action={
          c.isOwner ? (
            <Link to="/c/$ns/$name/edit" params={{ ns, name }} className={buttonVariants()}>
              Open the editor
            </Link>
          ) : undefined
        }
      />
    );
  }
  if (c.tombstoned) {
    return (
      <RemovedState
        title={`Version ${c.label} was ${tombstoneText(c.tombstoned.reason)}`}
        reason={c.tombstoned.reason}
        action={versions}
      />
    );
  }
  return (
    <div className="space-y-6">
      {c.yanked ? <YankedNotice label={c.label} reason={c.yanked.reason} /> : null}
      {children}
    </div>
  );
}

export function CreationShell({
  ns,
  name,
  v,
  children,
}: {
  ns: string;
  name: string;
  v: string | undefined;
  children: ReactNode;
}) {
  const load = useCreationLoad(ns, name, v);
  const versioned = useMatches({ select: (ms) => ms.some((m) => m.staticData?.creationVersioned) });

  if (load.status === "pending") return <PageSkeleton label="Loading the creation" />;
  if (load.status === "not-found") return <NotFound what={`@${ns}/${name}`} />;
  if (load.status === "error") {
    return (
      <ErrorState
        level={1}
        className="mx-auto w-full max-w-xl"
        title="This creation could not be loaded"
        description="We couldn't reach the registry. Check your connection and try again."
        error={load.error}
        onRetry={load.retry}
      />
    );
  }
  return (
    <CreationProvider value={load.state}>
      <div className="space-y-6">
        <CreationHeader />
        <CreationTabs />
        {versioned ? <VersionState>{children}</VersionState> : children}
      </div>
    </CreationProvider>
  );
}
