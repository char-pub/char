import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/components/operations";

export const Route = createFileRoute("/users")({ component: UsersPage });
