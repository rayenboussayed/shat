import { createElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { App } from "../../src/App.tsx";
import { BACKEND_ROUTES } from "../../src/lib/routes.ts";
import type { paths } from "shat-api-types";

vi.mock("../../src/lib/api.ts", () => ({
  api: {
    GET: vi.fn().mockResolvedValue({ data: { status: "ok" as const }, error: undefined }),
  },
}));

import { api } from "../../src/lib/api.ts";

/**
 * Compile-time exhaustiveness guard: every key of the generated `paths` type
 * must be listed here. A missing or extra key is a type error.
 */
const allRoutes: Record<keyof paths, true> = {
  "/health": true,
  "/identity/devices": true,
  "/identity/devices/{deviceId}/revoke": true,
  "/identity/device": true,
  "/prekeys/publish": true,
  "/prekeys/one-time": true,
  "/prekeys/claim": true,
  "/prekeys/signed": true,
  "/conversations": true,
  "/mailbox": true,
  "/mailbox/{id}/ack": true,
  "/delivery/receipts": true,
  "/attachments": true,
  "/attachments/download": true,
  "/attachments/{id}": true,
  "/turn/credentials": true,
  "/admin/health/live": true,
  "/admin/health/ready": true,
  "/telemetry/summary": true,
};

describe("dashboard shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.GET).mockResolvedValue({
      data: { status: "ok" as const },
      error: undefined,
    });
  });

  it("renders the dashboard title", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });
    expect(container.textContent).toContain("SHAT Operations Dashboard");
    root.unmount();
  });

  it("warns that the dashboard has no built-in authentication", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });
    const warning = container.querySelector('[data-testid="auth-warning"]');
    expect(warning).not.toBeNull();
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(warning?.textContent).toContain("no built-in authentication or authorization");
    expect(warning?.textContent).toContain("must not be exposed publicly");
    root.unmount();
  });

  it("requests health through the typed client", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(vi.mocked(api.GET)).toHaveBeenCalledWith("/health", expect.anything());
    root.unmount();
  });

  it("renders the health indicator", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const status = container.querySelector('[data-testid="health-status"]');
    expect(status?.textContent).toContain("Health: ok");
    root.unmount();
  });

  it("states that live telemetry is not wired into the dashboard", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });
    const panel = container.querySelector('[data-testid="metrics-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Live telemetry is not wired into this dashboard yet");
    expect(panel?.textContent).toContain("GET /telemetry/summary");
    expect(panel?.textContent).not.toMatch(/\d+\s*(ms|req|users|requests)/i);
    root.unmount();
  });

  it("lists the backend routes from the typed paths", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });
    const list = container.querySelector('[data-testid="route-list"]');
    for (const route of BACKEND_ROUTES) {
      expect(list?.textContent).toContain(route);
    }
    const items = list?.querySelectorAll('[data-testid="route-item"]');
    expect(items).not.toBeNull();
    expect(items?.length).toBe(BACKEND_ROUTES.length);
    root.unmount();
  });

  it("BACKEND_ROUTES lists only generated paths (a subset)", () => {
    for (const route of BACKEND_ROUTES) {
      expect(Object.prototype.hasOwnProperty.call(allRoutes, route)).toBe(true);
    }
    expect(BACKEND_ROUTES.length).toBeGreaterThan(0);
    expect(BACKEND_ROUTES.length).toBeLessThan(Object.keys(allRoutes).length);
  });
});