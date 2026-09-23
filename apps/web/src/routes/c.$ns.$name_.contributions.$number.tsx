import { createFileRoute } from "@tanstack/react-router";
import { ContributionReview } from "@/components/contribution-review";
import { useGuest, useMe } from "@/lib/registry";

export const Route = createFileRoute("/c/$ns/$name_/contributions/$number")({
  component: ContributionRoute,
});

function ContributionRoute() {
  const { ns, name, number } = Route.useParams();
  const me = useMe();
  const guest = useGuest(!me.isPending && !me.data);
  const n = Number(number);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return <p className="text-muted-foreground">This contribution does not exist.</p>;
  }
  if (me.isPending) return <p className="text-muted-foreground">Loading…</p>;
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
