import { createElement, useEffect, useState } from "react";
import { api } from "../lib/api.ts";

/** Possible health indicator states. */
type HealthState = "loading" | "ok" | "error";

/**
 * Health indicator that queries the backend `/health` endpoint through the
 * typed API client. Aborts the in-flight request on unmount.
 *
 * @returns The rendered health indicator element.
 */
export function HealthStatus(): ReturnType<typeof createElement> {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = await api.GET("/health", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (error !== undefined || data === undefined) {
          setHealth("error");
          return;
        }
        setHealth(data.status === "ok" ? "ok" : "error");
      } catch {
        if (!controller.signal.aborted) {
          setHealth("error");
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  return createElement(
    "section",
    { "aria-label": "Backend health" },
    createElement("h2", null, "Backend health"),
    createElement(
      "p",
      { "data-testid": "health-status", role: "status", "aria-live": "polite" },
      `Health: ${health}`,
    ),
  );
}