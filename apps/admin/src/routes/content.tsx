import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/moderation";

export const Route = createFileRoute("/content")({ component: ContentPage });
