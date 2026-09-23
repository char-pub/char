import { createFileRoute } from "@tanstack/react-router";
import { ContributionsTab } from "@/components/contribution-list";

export const Route = createFileRoute("/c/$ns/$name_/contributions/")({
  component: ContributionsRoute,
});

function ContributionsRoute() {
  const { ns, name } = Route.useParams();
  return <ContributionsTab ns={ns} name={name} />;
}
