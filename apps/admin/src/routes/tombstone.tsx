import { createFileRoute } from "@tanstack/react-router";
import { TombstonePage } from "@/components/tombstone";

export const Route = createFileRoute("/tombstone")({ component: () => <TombstonePage /> });
