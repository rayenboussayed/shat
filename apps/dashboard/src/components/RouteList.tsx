import { createElement } from "react";
import { BACKEND_ROUTES } from "../lib/routes.ts";

/**
 * Lists a subset of API routes, derived from the generated OpenAPI contract at
 * build time. Provides operational visibility without backend changes; the
 * list is intentionally not exhaustive.
 *
 * @returns The rendered route list element.
 */
export function RouteList(): ReturnType<typeof createElement> {
  return createElement(
    "section",
    { "aria-label": "Backend routes" },
    createElement("h2", null, "Backend routes (subset)"),
    createElement(
      "p",
      null,
      "A subset of API routes from the generated contract at build time; not exhaustive.",
    ),
    createElement(
      "ul",
      { "data-testid": "route-list" },
      ...BACKEND_ROUTES.map((route) =>
        createElement("li", { key: route, "data-testid": "route-item" }, route),
      ),
    ),
  );
}