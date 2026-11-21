import { MD3LightTheme } from "react-native-paper";
import type { MD3Theme } from "react-native-paper";

/**
 * Base color palette for the SHAT mobile app. Kept coherent with the MD3
 * scheme; no ad-hoc hex values elsewhere.
 */
const primary = "#1f6feb";
const secondary = "#57606a";
const tertiary = "#8250df";
const error = "#cf222e";

/**
 * Light MD3 theme used by {@link appTheme}.
 */
const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary,
    secondary,
    tertiary,
    error,
  },
};

/**
 * The single MD3 Paper theme for the app. Components should consume this
 * instance rather than constructing their own.
 */
export const appTheme: MD3Theme = lightTheme;