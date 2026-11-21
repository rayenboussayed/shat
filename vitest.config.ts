import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "apps/**/src/**/*.unit.test.ts",
            "apps/**/tests/unit/**/*.test.ts",
            "packages/**/src/**/*.unit.test.ts",
            "packages/**/tests/unit/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: ["apps/**/tests/integration/**/*.test.ts", "packages/**/tests/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["apps/**/tests/e2e/**/*.test.ts", "packages/**/tests/e2e/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "mem",
          include: [
            "apps/**/src/**/*.mem.test.ts",
            "apps/**/test/mem/**/*.test.ts",
            "packages/**/src/**/*.mem.test.ts",
            "packages/**/test/mem/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
