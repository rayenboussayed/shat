import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SafeAreaView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => createElement("span", null, name),
}));

vi.mock("react-native-paper", () => ({
  MD3LightTheme: { colors: {} },
  MD3DarkTheme: { colors: {} },
  PaperProvider: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}));

vi.mock("../../src/lib/api.ts", () => ({
  api: {
    GET: vi.fn().mockResolvedValue({ data: { status: "ok" }, error: undefined }),
  },
}));

import { api } from "../../src/lib/api.ts";
import { App } from "../../src/App.tsx";

describe("mobile shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.GET).mockResolvedValue({
      data: { status: "ok" },
      error: undefined,
    });
  });

  it("renders the app title", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App, null));
    });
    expect(container.textContent).toContain("SHAT");
    root.unmount();
  });

  it("requests health through the typed client", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App, null));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.GET).toHaveBeenCalledWith("/health", expect.anything());
    root.unmount();
  });
});