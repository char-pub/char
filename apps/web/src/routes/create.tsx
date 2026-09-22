import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/create")({ component: Create });

function Create() {
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-4xl">Create</h1>
      <p className="text-muted-foreground">
        The editor for characters, worlds and lorebooks — and the character card import wizard —
        will live here once sign-in is available.
      </p>
      <p>
        You can already explore how a creation turns into model context in the{" "}
        <Link to="/playground" className="underline">
          playground
        </Link>
        .
      </p>
    </section>
  );
}
