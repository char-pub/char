import { createFileRoute, Link } from "@tanstack/react-router";
import { GitCompareArrows } from "lucide-react";
import { Playground } from "@/components/playground";
import { buttonVariants } from "@/components/ui/button";
import { samples } from "@/fixtures/samples";

export const Route = createFileRoute("/playground/")({ component: PlaygroundPage });

function PlaygroundPage() {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl">Context playground</h1>
          <p className="max-w-2xl text-text-2">
            See exactly which fragments reach the model, and why — resolved and assembled right in
            your browser.
          </p>
        </div>
        <Link to="/playground/diff" className={buttonVariants({ variant: "outline" })}>
          <GitCompareArrows aria-hidden /> Compare two versions
        </Link>
      </header>
      <Playground samples={samples} />
    </div>
  );
}
