import { createElement } from "react";

/**
 * Operations metrics panel. No telemetry endpoints are exposed by the backend
 * yet, so this panel states that honestly instead of showing fabricated
 * numbers.
 *
 * @returns The rendered metrics panel element.
 */
export function MetricsPanel(): ReturnType<typeof createElement> {
  return createElement(
    "section",
    { "aria-label": "Operations metrics", "data-testid": "metrics-panel" },
    createElement("h2", null, "Operations metrics"),
    createElement(
      "p",
      null,
      "No telemetry endpoints are implemented yet; operational statistics are not exposed.",
    ),
    createElement(
      "p",
      null,
      "No fabricated metrics are shown. Counts and latency will appear here once the backend exposes them.",
    ),
  );
}