import { createFileRoute } from "@tanstack/react-router";
import { ApprovalsPage } from "@/components/tombstone";

export const Route = createFileRoute("/approvals")({ component: ApprovalsPage });
