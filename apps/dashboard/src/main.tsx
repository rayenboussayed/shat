import { createElement } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

/**
 * Application entry point. Mounts the dashboard shell into the root element.
 */
const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root was not found");
}

createRoot(rootElement).render(createElement(App));