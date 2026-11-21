import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/**
 * Local Vitest configuration for the dashboard app. Enables .tsx component
 * tests with a jsdom environment while reusing the Vite transform pipeline.
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