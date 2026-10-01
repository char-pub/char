import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { OAuthConsent } from "@/components/oauth";

export const Route = createFileRoute("/oauth/consent")({ component: ConsentRoute });

function ConsentRoute() {
  // Subscribe to navigation, but never use the router's normalized search serialization:
  // it changes the signed bytes and repeated ba_param fields from the provider.
  const route = useRouterState({ select: (state) => state.location.href });
  return <OAuthConsent key={route} oauthQuery={window.location.search.slice(1)} />;
}
