import { createFileRoute } from "@tanstack/react-router";
import { CsamPage } from "@/components/legal";

export const Route = createFileRoute("/csam")({ component: CsamPage });
