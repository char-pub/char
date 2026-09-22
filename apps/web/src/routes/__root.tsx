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
    <section className="space-y-3 py-16 text-center">
      <p className="stamp border-seal text-seal">404</p>
      <h1 className="text-3xl">This card is not in the catalog.</h1>
      <Link to="/" className="text-sm underline">
        Back to the front desk
      </Link>
    </section>
  ),
});
