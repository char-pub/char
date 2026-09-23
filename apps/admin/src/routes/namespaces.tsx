import { createFileRoute } from "@tanstack/react-router";
import { NamespacesPage } from "@/components/operations";

export const Route = createFileRoute("/namespaces")({ component: NamespacesPage });
