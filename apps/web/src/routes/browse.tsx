import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/browse")({ component: Browse });

function Browse() {
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-4xl">Browse</h1>
      <p className="text-muted-foreground">
        Search and browsing arrive with the registry API. Mature and explicit creations will stay
        hidden unless you turn them on in your settings.
      </p>
      <p>
        Meanwhile, look at a sample:{" "}
        <Link to="/c/$ns/$name" params={{ ns: "djj", name: "alice" }} className="underline">
          @djj/alice
        </Link>
      </p>
    </section>
  );
}
