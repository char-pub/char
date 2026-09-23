import { createFileRoute } from "@tanstack/react-router";
import { CsamPage } from "@/components/operations";

export const Route = createFileRoute("/csam")({ component: CsamPage });
