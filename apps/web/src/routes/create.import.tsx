import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ImportWizard } from "@/components/import-wizard";
import { NamespaceSetup } from "@/components/namespace-setup";
import { SignInRequired } from "@/components/sign-in-required";
import { useMe } from "@/lib/registry";

export const Route = createFileRoute("/create/import")({ component: ImportRoute });

function ImportRoute() {
  const me = useMe();
  const navigate = useNavigate();
  if (me.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!me.data) return <SignInRequired what="import a character card" />;
  const ns = me.data.namespace;
  return (
    <section className="max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="text-sm">
          <Link to="/create" className="underline">
            Create
          </Link>{" "}
          / Import
        </p>
        <h1 className="text-4xl">Import a character card</h1>
        <p className="max-w-prose text-muted-foreground">
          Bring a Character Card V2/V3 (PNG, JSON or CHARX) to char.pub. You will see exactly what
          was mapped, what was left out and why, and confirm the rating, rights and license before
          it can be published.
        </p>
      </header>
      {ns ? (
        <ImportWizard
          ns={ns}
          onCreated={(name) => void navigate({ to: "/c/$ns/$name/edit", params: { ns, name } })}
        />
      ) : (
        <NamespaceSetup suggestion={me.data.name} />
      )}
    </section>
  );
}
