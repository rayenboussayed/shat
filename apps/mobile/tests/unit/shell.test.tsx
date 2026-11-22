import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

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
  Button: ({ children, onPress }: { children: ReactNode; onPress?: () => void }) =>
    createElement("button", { onClick: onPress }, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: {
    value?: string;
    onChangeText?: (value: string) => void;
    accessibilityLabel?: string;
  }) =>
    createElement("input", {
      value,
      "aria-label": accessibilityLabel,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));

vi.mock("../../src/lib/api.ts", () => ({
  api: {
    GET: vi.fn(),
    POST: vi.fn(),
  },
}));

import { api } from "../../src/lib/api.ts";
import { App } from "../../src/App.tsx";

describe("mobile shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.GET).mockImplementation(async (path) => {
      const data = path === "/conversations" ? { conversations: [] } : { status: "ok" };
      return { data, error: undefined, response: new Response() } satisfies Awaited<
        ReturnType<typeof api.GET>
      >;
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

  it("mounts the chat screen so demo messaging is reachable", async () => {
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
    expect(container.textContent).toContain("Conversations");
    expect(container.textContent).toContain("demo / not E2EE");
    expect(api.GET).toHaveBeenCalledWith("/conversations", expect.anything());
    root.unmount();
  });
});
