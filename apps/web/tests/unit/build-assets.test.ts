import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = process.cwd();
const webRoot = basename(cwd) === "web" ? cwd : join(cwd, "apps/web");
const viteBin = resolve(webRoot, "../../node_modules/vite/bin/vite.js");

/**
 * Guards the production styling regression: StyleX CSS is only useful when
 * Vite emits a CSS asset and links it from the built HTML shell.
 */
describe("web production build assets", () => {
  it("links a stylesheet that contains the StyleX component rules", () => {
    execFileSync(process.execPath, [viteBin, "build"], {
      cwd: webRoot,
      // Vitest sets NODE_ENV=test; force the real production build here.
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
    });

    const html = readFileSync(join(webRoot, "dist/index.html"), "utf8");
    expect(html).toMatch(/<link rel="stylesheet"[^>]*href="\/assets\/[^"]+\.css"/);

    const assetsDir = join(webRoot, "dist/assets");
    const cssFiles = readdirSync(assetsDir).filter((name) => name.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThan(0);
    const css = cssFiles
      .map((name) => readFileSync(join(assetsDir, name), "utf8"))
      .join("\n");
    expect(css).toMatch(/border-width/);
    expect(css).toMatch(/--x/);
  }, 60_000);
});
