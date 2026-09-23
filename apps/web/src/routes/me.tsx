import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { SignInRequired } from "@/components/sign-in-required";
import { buttonVariants } from "@/components/ui/button";
import { UserText } from "@/components/user-content";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { formatDate, localized, parseRef } from "@/lib/text";

export const Route = createFileRoute("/me")({ component: MyCreations });

function MyCreations() {
  const me = useMe();
  const client = useRegistry();
  const list = useQuery({
    queryKey: keys.myCreations,
    queryFn: () => client.myCreations(),
    enabled: !!me.data,
  });

  if (me.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!me.data) return <SignInRequired what="see your creations" />;

  return (
    <section className="max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl">My creations</h1>
          {me.data.namespace ? (
            <p className="font-mono text-sm text-muted-foreground">@{me.data.namespace}</p>
          ) : null}
        </div>
        <Link to="/create" className={buttonVariants()}>
          <Plus aria-hidden /> New creation
        </Link>
      </header>
      {list.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.isError ? (
        <p role="alert" className="text-seal">
          Could not load your creations.
        </p>
      ) : list.data.items.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing here yet.{" "}
          <Link to="/create" className="underline">
            Create your first character
          </Link>{" "}
          or import a character card.
        </p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {list.data.items.map((c) => {
            const r = parseRef(c.ref);
            return (
              <li key={c.ref} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-display text-lg">
                    <UserText text={localized(c.display_name)} />
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.ref} · {c.type}
                    {c.latest_release
                      ? ` · ${c.latest_release.label} (${c.latest_release.visibility}${c.latest_release.status === "active" ? "" : `, ${c.latest_release.status}`})`
                      : " · not published"}
                    {c.draft_updated_at ? ` · edited ${formatDate(c.draft_updated_at)}` : ""}
                  </p>
                </div>
                {r ? (
                  <div className="flex gap-2">
                    <Link
                      to="/c/$ns/$name/edit"
                      params={r}
                      className={buttonVariants({ size: "sm" })}
                    >
                      Edit
                    </Link>
                    {c.latest_release ? (
                      <Link
                        to="/c/$ns/$name"
                        params={r}
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                      >
                        View
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
