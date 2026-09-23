import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GitPullRequestArrow } from "lucide-react";
import {
  ContributionList,
  ContributionSettings,
  POLICY_LABEL,
} from "@/components/contribution-list";
import { GuestIdentity } from "@/components/guest";
import { buttonVariants } from "@/components/ui/button";
import { UserText } from "@/components/user-content";
import { isApiError } from "@/lib/api";
import { keys, useGuest, useMe, useRegistry } from "@/lib/registry";
import { localized } from "@/lib/text";

export const Route = createFileRoute("/c/$ns/$name_/contributions/")({
  component: ContributionsRoute,
});

function ContributionsRoute() {
  const { ns, name } = Route.useParams();
  const client = useRegistry();
  const me = useMe();
  const guest = useGuest(!me.isPending && !me.data);
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });

  if (detail.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (detail.isError) {
    return isApiError(detail.error) && detail.error.status === 404 ? (
      <p className="text-muted-foreground">This creation is not in the catalog.</p>
    ) : (
      <p role="alert" className="text-seal">
        This creation could not be loaded.
      </p>
    );
  }
  const d = detail.data;
  const member = !!me.data && me.data.namespace === ns;
  const canPropose =
    !member && d.contribution_policy !== "closed" && d.latest_release !== undefined;

  return (
    <section className="max-w-4xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm">
          <Link to="/c/$ns/$name" params={{ ns, name }} className="underline">
            <UserText text={localized(d.display_name)} />
          </Link>{" "}
          / Contributions
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-4xl">Contributions</h1>
          {canPropose ? (
            <Link
              to="/c/$ns/$name/contributions/new"
              params={{ ns, name }}
              className={buttonVariants({ size: "sm" })}
            >
              <GitPullRequestArrow aria-hidden /> Propose a change
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Open to: {POLICY_LABEL[d.contribution_policy]}.
        </p>
        {!me.data && guest.data ? <GuestIdentity session={guest.data} /> : null}
      </header>

      {member ? <ContributionSettings ns={ns} name={name} policy={d.contribution_policy} /> : null}

      {me.data ? (
        <ContributionList ns={ns} name={name} meId={me.data.id} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Contributions are visible to the author and to the person who submitted them.
        </p>
      )}
    </section>
  );
}
