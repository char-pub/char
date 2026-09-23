import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ImportWizard } from "@/components/import-wizard";
import { NamespaceSetup } from "@/components/namespace-setup";
import { SignInRequired } from "@/components/sign-in-required";
import { PageSkeleton } from "@/components/skeletons";
import { useMe } from "@/lib/registry";

export const Route = createFileRoute("/create/import")({ component: ImportRoute });

function ImportRoute() {
  const me = useMe();
  const navigate = useNavigate();
  if (me.isPending) return <PageSkeleton label="Loading" className="mx-auto max-w-4xl" />;
  if (!me.data) return <SignInRequired what="import a character card" />;
  const ns = me.data.namespace;
  return (
    <section className="mx-auto max-w-4xl space-y-8 md:pt-6">
      <header className="space-y-2">
        <Link
          to="/create"
          className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-text"
        >
          <ArrowLeft aria-hidden className="size-4" /> Create
        </Link>
        <h1 className="text-4xl font-bold tracking-tight">Import a character card</h1>
        <p className="max-w-prose text-text-2">
          Bring a Character Card V2 or V3 (PNG, JSON or CHARX) to char.pub. You'll see what was
          mapped and what was left out, then confirm the rating, rights and license before it can be
          published.
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
