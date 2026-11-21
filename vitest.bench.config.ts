import { defineConfig } from "vitest/config";

const perfGlobs = ["apps/**/test/perf/**/*.bench.ts", "packages/**/test/perf/**/*.bench.ts"];

export default defineConfig({
  test: {
    include: perfGlobs,
    benchmark: {
      include: perfGlobs,
    },
  },
});
