import { createElement } from "react";
import { HealthStatus } from "./components/HealthStatus.tsx";
import { MetricsPanel } from "./components/MetricsPanel.tsx";
import { RouteList } from "./components/RouteList.tsx";

/**
 * Dashboard application shell. Composes the health indicator, the honest
 * operations metrics panel and the backend route list.
 *
 * @returns The rendered application shell.
 */
export function App(): ReturnType<typeof createElement> {
  return createElement(
    "main",
    { "aria-label": "SHAT operations dashboard" },
    createElement("h1", null, "SHAT Operations Dashboard"),
    createElement(
      "aside",
      { role: "alert", "data-testid": "auth-warning" },
      "Warning: this dashboard has no built-in authentication or authorization. " +
        "It must be deployed behind an authenticating reverse proxy and must not be exposed publicly.",
    ),
    createElement(HealthStatus),
    createElement(MetricsPanel),
    createElement(RouteList),
  );
}

const DashboardApp = App;
export default DashboardApp;

