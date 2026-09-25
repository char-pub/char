import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useCreation, useReleaseLabels } from "@/components/creation-context";
import {
  BuiltOn,
  Credits,
  FactCard,
  matureReason,
  ReleaseFacts,
  UsedBy,
  WhyThisRating,
} from "@/components/creation-facts";
import { CreationContent } from "@/components/creation-overview";
import { MatureGate } from "@/components/mature-gate";
import { PolicyContent } from "@/components/policy-artifact";
import { RATING_LABEL } from "@/components/rating";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { dependenciesOf } from "@/lib/creation-graph";
import { keys, useRegistry } from "@/lib/registry";
import { localized } from "@/lib/text";

export const Route = createFileRoute("/c/$ns/$name/")({
  staticData: { creationVersioned: true },
  component: OverviewTab,
});

function ContentSkeleton() {
  return (
    <div role="status" aria-label="Loading the content" className="space-y-3">
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="space-y-3 rounded-lg border bg-surface p-5">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}

/**
 * Overview：左边是正文（开场白与内容片段，成人内容先遮挡），右边是事实栏（评级来源、依赖、
 * 被谁依赖、署名与许可、发布信息）。外框已经处理了版本不存在、未发布和已移除。
 */
function OverviewTab() {
  const c = useCreation();
  const client = useRegistry();
  const [allDependents, setAllDependents] = useState(false);
  const dependents = useQuery({
    queryKey: keys.dependents(c.ns, c.name),
    queryFn: () => client.dependents(c.ns, c.name),
  });
  const labels = useReleaseLabels(c.ir ? dependenciesOf(c.ir).map((d) => d.ref) : []);
  const title = localized(c.detail.display_name);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        {c.artifact && c.artifact.kind !== "content" ? (
          <MatureGate
            rating={c.rating}
            allowed={c.allowMature}
            remember={c.detail.ref}
            signedIn={!!c.me}
          >
            <PolicyContent artifact={c.artifact} />
          </MatureGate>
        ) : c.ir ? (
          <MatureGate
            rating={c.rating}
            allowed={c.allowMature}
            remember={c.detail.ref}
            reason={matureReason(c.ir)}
            signedIn={!!c.me}
          >
            <CreationContent ir={c.ir} />
          </MatureGate>
        ) : c.irState === "error" || c.artifactError ? (
          <ErrorState
            title="The content of this version could not be loaded"
            description="The rest of the page is still accurate. Try loading the content again."
            onRetry={c.retryIr}
          />
        ) : (
          <ContentSkeleton />
        )}
      </div>

      <aside aria-label="About this creation" className="space-y-4">
        {c.ir ? (
          <WhyThisRating ir={c.ir} name={title} />
        ) : (
          <FactCard id="c-rating" title="Why this rating">
            <p className="text-sm text-text-2">
              Rated {RATING_LABEL[c.rating]}: the highest rating found in the creation, its
              dependencies and its images.
            </p>
          </FactCard>
        )}
        {c.ir ? <BuiltOn ir={c.ir} labels={labels} /> : null}
        <UsedBy
          items={dependents.data?.items}
          total={Math.max(c.detail.dependents_count, dependents.data?.items.length ?? 0)}
          state={dependents.isPending ? "loading" : dependents.isError ? "error" : "ready"}
          expanded={allDependents}
          onExpand={() => setAllDependents(true)}
        />
        {c.ir ? <Credits ir={c.ir} /> : null}
        {c.selected ? <ReleaseFacts ns={c.ns} summary={c.selected} detail={c.release} /> : null}
      </aside>
    </div>
  );
}
