import { createFileRoute, Link } from "@tanstack/react-router";
import { Playground } from "@/components/playground";
import { samples } from "@/fixtures/samples";

export const Route = createFileRoute("/playground/")({ component: PlaygroundPage });

function PlaygroundPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-4xl">Context playground</h1>
          <p className="max-w-2xl text-muted-foreground">
            See exactly which fragments reach the model, and why — resolved and assembled right in
            your browser.
          </p>
        </div>
        <Link
          to="/playground/diff"
          className="text-sm underline decoration-seal underline-offset-4"
        >
          Compare two versions →
        </Link>
      </header>
      <Playground samples={samples} />
    </div>
  );
}
