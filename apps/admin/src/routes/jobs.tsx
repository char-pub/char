import { createFileRoute } from "@tanstack/react-router";
import { JobsPage } from "@/components/operations";

export const Route = createFileRoute("/jobs")({ component: JobsPage });
