import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/components/moderation";

export const Route = createFileRoute("/reports")({ component: ReportsPage });
