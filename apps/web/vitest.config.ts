import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/**
 * Local Vitest configuration for the web app. The root configuration only
 * matches .test.ts files, so this one enables .tsx component tests with a
 * jsdom environment while reusing the Vite transform pipeline.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "src/**/*.unit.test.ts", "src/**/*.unit.test.tsx"],
      globals: false,
    },
  }),
);
