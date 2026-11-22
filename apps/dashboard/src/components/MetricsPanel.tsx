import { createElement } from "react";

/**
 * Operations metrics panel. Live telemetry is not wired into this dashboard
 * yet: the backend does expose `GET /telemetry/summary`, but this UI does not
 * consume it, so the panel says so honestly instead of showing fabricated
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
      "Live telemetry is not wired into this dashboard yet; the backend exposes GET /telemetry/summary but this UI does not consume it.",
    ),
    createElement(
      "p",
      null,
      "No fabricated metrics are shown. Counts and latency will appear here once this dashboard consumes the telemetry endpoint.",
    ),
  );
}