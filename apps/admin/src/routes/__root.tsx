import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { Layout } from "@/components/layout";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
  notFoundComponent: () => (
    <section className="space-y-2 py-12 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-lg">No such admin page.</h1>
      <Link to="/" className="text-sm underline">
        Back to the dashboard
      </Link>
    </section>
  ),
});
