import { createFileRoute } from "@tanstack/react-router";
import { StaffPage } from "@/components/staff";

export const Route = createFileRoute("/staff")({ component: StaffPage });
