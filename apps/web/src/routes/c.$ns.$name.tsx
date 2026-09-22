import { canonicalizeCreation } from "@char-pub/core";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { CreationPage } from "@/components/creation-page";
import { diffPair, resolveSample, samples } from "@/fixtures/samples";

/** 示例作品按 ref 索引；同一个 ref 取最后一个（版本最新的）示例。 */
function findSample(ref: string) {
  const all = [...samples, diffPair.to];
  let found: (typeof all)[number] | undefined;
  for (const s of all) {
    if (canonicalizeCreation(s.root.creation).creation.ref === ref) found = s;
  }
  return found;
}

export const Route = createFileRoute("/c/$ns/$name")({
  loader: ({ params }) => {
    const s = findSample(`@${params.ns}/${params.name}`);
    if (!s) throw notFound();
    const creation = canonicalizeCreation(s.root.creation).creation;
    const summary = typeof creation.summary === "string" ? creation.summary : undefined;
    return { ir: resolveSample(s).ir, summary };
  },
  component: CreationRoute,
});

function CreationRoute() {
  const { ir, summary } = Route.useLoaderData();
  return <CreationPage ir={ir} {...(summary ? { summary } : {})} />;
}
