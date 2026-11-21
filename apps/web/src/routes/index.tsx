import { createElement } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { isGhostModeEnabled } from "../lib/ghost.ts";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex.ts";

const styles = stylex.create({
  shell: {
    padding: tokens.spacingMedium,
    fontFamily: "system-ui, sans-serif",
    backgroundColor: tokens.colorBackground,
    color: tokens.colorForeground,
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
  },
  status: {
    marginTop: tokens.spacingSmall,
  },
  ghost: {
    marginTop: tokens.spacingSmall,
    color: tokens.colorAccent,
  },
});

type HealthState = "loading" | "ok" | "error";

/**
 * Application shell route. Fetches backend health through the typed client and
 * shows the Ghost Mode indicator, which defaults to on.
 */
export function IndexComponent() {
  const [health, setHealth] = useState<HealthState>("loading");
  const ghostMode = isGhostModeEnabled(undefined);

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
    "main",
    { ...stylex.props(styles.shell) },
    createElement("h1", { ...stylex.props(styles.title) }, "SHAT"),
    createElement(
      "p",
      { ...stylex.props(styles.status), "data-testid": "health-status" },
      `Health: ${health}`,
    ),
    ghostMode
      ? createElement(
          "p",
          { ...stylex.props(styles.ghost), "data-testid": "ghost-mode" },
          "Ghost Mode: on",
        )
      : null,
  );
}

/** Route definition for the application shell. */
export const Route = createFileRoute("/")({
  component: IndexComponent,
});
