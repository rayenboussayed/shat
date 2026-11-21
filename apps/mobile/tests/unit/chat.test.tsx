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

vi.mock("react-native-paper", () => ({
  MD3LightTheme: { colors: {} },
  MD3DarkTheme: { colors: {} },
  PaperProvider: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  Button: ({ children, onPress }: { children: ReactNode; onPress?: () => void }) =>
    createElement("button", { onClick: onPress }, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: { value?: string; onChangeText?: (v: string) => void; accessibilityLabel?: string }) =>
    createElement("input", {
      value,
      "aria-label": accessibilityLabel,
      onChange: (e: { target: { value: string } }) => onChangeText?.(e.target.value),
    }),
}));

vi.mock("../../src/lib/api.ts", () => ({
  api: {
    GET: vi.fn(),
    POST: vi.fn(),
  },
}));

import { api } from "../../src/lib/api.ts";
import { ChatScreen } from "../../src/screens/ChatScreen.tsx";

function render(_element: ReturnType<typeof createElement>) {
  void _element;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ChatScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const conversationPayload = {
      data: {
        conversations: [
          { id: "conv-1", kind: "direct", createdAt: "2026-01-01T00:00:00Z", members: ["a", "b"] },
        ],
      },
      error: undefined,
    } satisfies {
      data: {
        conversations: readonly {
          readonly id: string;
          readonly kind: string;
          readonly createdAt: string;
          readonly members: readonly string[];
        }[];
      };
      error: undefined;
    };
    const mailboxPayload = {
      data: {},
      error: undefined,
    } satisfies { data: Record<string, unknown>; error: undefined };
    vi.mocked(api.GET).mockResolvedValue(
      conversationPayload as unknown as Awaited<ReturnType<typeof api.GET>>,
    );
    vi.mocked(api.POST).mockResolvedValue(
      mailboxPayload as unknown as Awaited<ReturnType<typeof api.POST>>,
    );
  });

  it("renders conversations", async () => {
    const { container, root } = render(createElement(ChatScreen));
    await act(async () => {
      root.render(createElement(ChatScreen));
    });
    await flush();
    expect(container.textContent).toContain("conv-1");
    root.unmount();
  });

  it("calls the typed client on send", async () => {
    const { container, root } = render(createElement(ChatScreen));
    await act(async () => {
      root.render(createElement(ChatScreen));
    });
    await flush();
    const input = container.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("input not found");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter?.call(input, "hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Send"),
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("send button not found");
    }
    await act(async () => {
      button.click();
    });
    await flush();
    expect(api.POST).toHaveBeenCalledWith(
      "/mailbox",
      expect.objectContaining({
        body: expect.objectContaining({
          envelope: "hello",
        }),
      }),
    );
    root.unmount();
  });
});
