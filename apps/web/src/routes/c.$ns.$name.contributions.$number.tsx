import { createFileRoute } from "@tanstack/react-router";
import { ContributionReview } from "@/components/contribution-review";
import { useCreation } from "@/components/creation-context";
import { PageSkeleton } from "@/components/skeletons";
import { NotFound } from "@/components/states";
import { useGuest, useMe } from "@/lib/registry";

export const Route = createFileRoute("/c/$ns/$name/contributions/$number")({
  component: ContributionRoute,
});

function ContributionRoute() {
  const { ns, name, number } = Route.useParams();
  const me = useMe();
  const creation = useCreation();
  const guest = useGuest(!me.isPending && !me.data);
  const n = Number(number);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return (
      <NotFound level={2} what={`#${number}`} description="This contribution does not exist." />
    );
  }
  if (me.isPending) return <PageSkeleton label="Loading the contribution…" />;
  return (
    <ContributionReview
      ns={ns}
      name={name}
      number={n}
      member={creation.canEdit}
      canUpdateSensitive={creation.isOwner}
      key={`${me.data?.id ?? guest.data?.guest.id ?? "anonymous"}:${ns}/${name}/${n}`}
      meId={me.data?.id}
      guest={guest.data}
    />
  );
}
