import { createElement } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";

/**
 * Root layout route. Renders the shared shell around every child route.
 */
export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return createElement(Outlet);
}
