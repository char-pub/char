import { createFileRoute } from "@tanstack/react-router";
import { AuditPage } from "@/components/audit";

export const Route = createFileRoute("/audit")({ component: AuditPage });
