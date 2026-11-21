import { StrictMode } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";

/**
 * Application entry point. Creates the TanStack router from the generated route
 * tree and mounts it into the root element.
 */
const router = createRouter({ routeTree });

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root was not found");
}

createRoot(rootElement).render(
  createElement(StrictMode, null, createElement(RouterProvider, { router })),
);
