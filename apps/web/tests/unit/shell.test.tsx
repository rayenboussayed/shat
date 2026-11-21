import { createElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { IndexComponent } from "../../src/routes/index.tsx";

vi.mock("../../src/lib/api.ts", () => ({
  api: {
    GET: vi.fn().mockResolvedValue({ data: { status: "ok" as const }, error: undefined }),
  },
}));

import { api } from "../../src/lib/api.ts";

describe("web shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.GET).mockResolvedValue({
      data: { status: "ok" as const },
      error: undefined,
    });
  });

  it("renders the app title", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(IndexComponent));
    });
    expect(container.textContent).toContain("SHAT");
    root.unmount();
  });

  it("requests health through the typed client", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(IndexComponent));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.GET).toHaveBeenCalledWith("/health", expect.anything());
    root.unmount();
  });

  it("shows Ghost Mode on by default", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(IndexComponent));
    });
    expect(
      container.querySelector('[data-testid="ghost-mode"]')?.textContent,
    ).toContain("on");
    root.unmount();
  });
});
