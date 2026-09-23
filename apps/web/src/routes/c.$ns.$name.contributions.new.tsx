import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ContributionForm } from "@/components/contribution-form";
import { GuestIdentity, GuestVerificationForm } from "@/components/guest";
import { SignInRequired } from "@/components/sign-in-required";
import { UserText } from "@/components/user-content";
import { isApiError } from "@/lib/api";
import { keys, useGuest, useMe, useRegistry } from "@/lib/registry";
import { localized } from "@/lib/text";

export const Route = createFileRoute("/c/$ns/$name/contributions/new")({
  component: NewContributionRoute,
});

function NewContributionRoute() {
  const { ns, name } = Route.useParams();
  const client = useRegistry();
  const me = useMe();
  const guest = useGuest(!me.isPending && !me.data);
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });

  if (detail.isPending || me.isPending) return <p className="text-muted-foreground">Loading…</p>;
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
  const label = d.latest_release?.label;
  const header = (
    <header className="space-y-2">
      <p className="text-sm">
        <Link to="/c/$ns/$name" params={{ ns, name }} className="underline">
          <UserText text={localized(d.display_name)} />
        </Link>{" "}
        /{" "}
        <Link to="/c/$ns/$name/contributions" params={{ ns, name }} className="underline">
          Contributions
        </Link>{" "}
        / New
      </p>
      <h1 className="text-4xl">Propose a change</h1>
    </header>
  );

  let body: ReactNode;
  if (d.contribution_policy === "closed") {
    body = <p className="text-muted-foreground">This creation is not accepting contributions.</p>;
  } else if (!label) {
    body = (
      <p className="text-muted-foreground">
        This creation has no public release yet, so there is nothing to build on.
      </p>
    );
  } else if (me.data?.namespace === ns) {
    body = (
      <p className="text-muted-foreground">
        This is your creation.{" "}
        <Link to="/c/$ns/$name/edit" params={{ ns, name }} className="underline">
          Edit the draft
        </Link>{" "}
        directly instead.
      </p>
    );
  } else if (me.data) {
    body = <ContributionForm ns={ns} name={name} label={label} type={d.type} />;
  } else if (d.contribution_policy !== "anyone") {
    body = <SignInRequired what="contribute to this creation" />;
  } else if (guest.isPending) {
    body = <p className="text-muted-foreground">Loading…</p>;
  } else if (guest.data) {
    body = (
      <div className="space-y-6">
        <GuestIdentity session={guest.data} />
        <ContributionForm ns={ns} name={name} label={label} type={d.type} />
      </div>
    );
  } else {
    body = (
      <section aria-labelledby="guest-verify" className="catalog-card max-w-2xl space-y-4 p-5 pl-8">
        <h2 id="guest-verify" className="font-display text-xl">
          Contribute as a guest
        </h2>
        <GuestVerificationForm returnTo={`/c/${ns}/${name}/contributions/new`} />
        <p className="text-xs text-muted-foreground">
          Have an account? Use <strong>Sign in</strong> at the top right instead.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-4xl space-y-8">
      {header}
      {body}
    </section>
  );
}
