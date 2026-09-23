import { createFileRoute } from "@tanstack/react-router";
import { TombstonePage } from "@/components/tombstone";

/** `?subject=` 预先填入要下架的对象，从内容页或法律请求详情跳转过来时使用。 */
export const Route = createFileRoute("/tombstone")({
  validateSearch: (search: Record<string, unknown>): { subject?: string } =>
    typeof search.subject === "string" && search.subject.length <= 300
      ? { subject: search.subject }
      : {},
  component: TombstoneRoute,
});

function TombstoneRoute() {
  const { subject } = Route.useSearch();
  return <TombstonePage key={subject ?? ""} {...(subject ? { initialSubject: subject } : {})} />;
}
