import { createFileRoute } from "@tanstack/react-router";
import { NewContributionTab } from "@/components/contribution-new";

export const Route = createFileRoute("/c/$ns/$name/contributions/new")({
  component: NewContributionRoute,
});

function NewContributionRoute() {
  const { ns, name } = Route.useParams();
  return <NewContributionTab ns={ns} name={name} />;
}
