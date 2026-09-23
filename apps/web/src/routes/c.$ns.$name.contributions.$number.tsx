import { createFileRoute } from "@tanstack/react-router";
import { ContributionReview } from "@/components/contribution-review";
import { PageSkeleton } from "@/components/skeletons";
import { NotFound } from "@/components/states";
import { useGuest, useMe } from "@/lib/registry";

export const Route = createFileRoute("/c/$ns/$name/contributions/$number")({
  component: ContributionRoute,
});

function ContributionRoute() {
  const { ns, name, number } = Route.useParams();
  const me = useMe();
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
      member={!!me.data && me.data.namespace === ns}
      meId={me.data?.id}
      guest={guest.data}
    />
  );
}
