import * as stylex from "@stylexjs/stylex";

/**
 * Design tokens for the SHAT web shell.
 */
export const tokens = stylex.defineVars({
  colorBackground: "#f7f7f9",
  colorForeground: "#1a1a1a",
  colorAccent: "#2563eb",
  /** Muted amber used for unverified/demo status text. */
  colorMuted: "#b45309",
  /** Text and icon colour placed on the accent background. */
  colorOnAccent: "#ffffff",
  /** Keyboard focus ring colour. */
  colorFocus: "#1d4ed8",
  /** Neutral border colour for inputs, panels and list separators. */
  colorBorder: "#d1d5db",
  spacingSmall: "0.5rem",
  spacingMedium: "1rem",
  radiusMedium: "0.5rem",
  borderWidthThin: "1px",
  focusRingWidth: "2px",
  focusRingOffset: "2px",
});
