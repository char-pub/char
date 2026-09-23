import { createFileRoute } from "@tanstack/react-router";
import { GuestsPage } from "@/components/guests";

export const Route = createFileRoute("/guests")({ component: GuestsPage });
