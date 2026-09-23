import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal";

export const Route = createFileRoute("/legal")({ component: LegalPage });
