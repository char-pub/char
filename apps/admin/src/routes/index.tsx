import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/operations";

export const Route = createFileRoute("/")({ component: DashboardPage });
