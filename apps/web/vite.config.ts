import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import tanstackRouter from "@tanstack/router-plugin/vite";

/** Restrictive CSP shipped in every build. */
const productionCsp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://localhost:3000; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/** CSP with the exceptions Vite HMR and StyleX dev styles need. */
const developmentCsp = productionCsp
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");

/** Vite configuration for the SHAT web shell. */
export default defineConfig({
  plugins: [
    tanstackRouter(),
    stylex.vite(),
    react(),
    {
      name: "shat-web-dev-csp",
      apply: "serve",
      transformIndexHtml(html: string): string {
        return html.replace(
          /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/,
          `<meta http-equiv="Content-Security-Policy" content="${developmentCsp}" />`,
        );
      },
    },
  ],
});
