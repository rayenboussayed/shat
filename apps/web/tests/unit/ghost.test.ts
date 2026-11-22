import { describe, expect, it } from "vitest";
import { isGhostModeEnabled, GHOST_MODE_DEFAULT } from "shat-api-types";

describe("ghost mode", () => {
  it("defaults to on", () => {
    expect(GHOST_MODE_DEFAULT).toBe(true);
    expect(isGhostModeEnabled(undefined)).toBe(true);
  });

  it("respects an explicit value", () => {
    expect(isGhostModeEnabled(false)).toBe(false);
    expect(isGhostModeEnabled(true)).toBe(true);
  });
});
