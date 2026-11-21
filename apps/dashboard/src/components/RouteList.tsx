import { createElement } from "react";
import { BACKEND_ROUTES } from "../lib/routes.ts";

/**
 * Lists the backend routes that currently exist, derived from the generated
 * OpenAPI types. Provides operational visibility without backend changes.
 *
 * @returns The rendered route list element.
 */
export function RouteList(): ReturnType<typeof createElement> {
  return createElement(
    "section",
    { "aria-label": "Backend routes" },
    createElement("h2", null, "Backend routes"),
    createElement(
      "ul",
      { "data-testid": "route-list" },
      ...BACKEND_ROUTES.map((route) =>
        createElement("li", { key: route, "data-testid": "route-item" }, route),
      ),
    ),
  );
}