import { createFileRoute } from "@tanstack/react-router";
import { FlagsPage } from "@/components/flags";

export const Route = createFileRoute("/flags")({ component: FlagsPage });
