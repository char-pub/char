import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/operations";

export const Route = createFileRoute("/legal")({ component: LegalPage });
