import { createElement, Fragment } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex.ts";

const styles = stylex.create({
  skipLink: {
    position: "absolute",
    top: "-1000px",
    left: tokens.spacingMedium,
    zIndex: 1,
    padding: tokens.spacingSmall,
    backgroundColor: tokens.colorBackground,
    color: tokens.colorForeground,
    ":focus": {
      top: tokens.spacingMedium,
    },
  },
});

/**
 * Root layout route. Renders the shared shell around every child route.
 */
export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Shared shell with a keyboard skip link ahead of the routed content. The
 * wrapper is the skip target for every child route, so no route needs its own
 * anchor id.
 *
 * @returns The skip link followed by the routed outlet in its skip target.
 */
function RootComponent() {
  return createElement(
    Fragment,
    null,
    createElement(
      "a",
      { href: "#main-content", ...stylex.props(styles.skipLink) },
      "Skip to content",
    ),
    createElement(
      "div",
      { id: "main-content", tabIndex: -1 },
      createElement(Outlet),
    ),
  );
}
