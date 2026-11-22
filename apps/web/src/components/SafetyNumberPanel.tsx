import { createElement } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex.ts";

const styles = stylex.create({
  panel: {
    marginTop: tokens.spacingMedium,
    padding: tokens.spacingSmall,
    borderWidth: tokens.borderWidthThin,
    borderStyle: "solid",
    borderColor: tokens.colorBorder,
    borderRadius: tokens.radiusMedium,
  },
  title: {
    fontWeight: 700,
  },
  status: {
    marginTop: tokens.spacingSmall,
    color: tokens.colorMuted,
  },
});

/**
 * Read-only panel reporting that the device identity is not yet verified.
 *
 * No verification claim is made; encryption and identity verification are not
 * implemented in this build.
 *
 * @returns The rendered safety-number panel.
 */
export function SafetyNumberPanel() {
  return createElement(
    "section",
    { ...stylex.props(styles.panel), "aria-label": "Safety number" },
    createElement("h2", { ...stylex.props(styles.title) }, "Safety number"),
    createElement(
      "p",
      null,
      "Device identity is not yet verified. Verification is not implemented in this build.",
    ),
    createElement(
      "p",
      { ...stylex.props(styles.status), role: "status" },
      "Status: unverified",
    ),
  );
}