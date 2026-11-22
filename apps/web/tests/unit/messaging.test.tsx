import { createElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ConversationList } from "../../src/components/ConversationList.tsx";
import { MessageComposer } from "../../src/components/MessageComposer.tsx";
import { MailboxPoll } from "../../src/components/MailboxPoll.tsx";
import { SafetyNumberPanel } from "../../src/components/SafetyNumberPanel.tsx";
import { derivePlaceholderEnvelope } from "../../src/lib/envelope.ts";
import { isGhostModeEnabled, GHOST_MODE_DEFAULT } from "shat-api-types";

vi.mock("../../src/lib/api.ts", () => ({
  api: {
    GET: vi.fn(),
    POST: vi.fn(),
  },
}));

import { api } from "../../src/lib/api.ts";

function render(element: ReturnType<typeof createElement>) {
  void element;
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

/** Types into the composer and submits it, flushing all resulting updates. */
async function typeAndSubmit(container: HTMLElement, value: string) {
  const textareaNode = container.querySelector("textarea");
  if (!(textareaNode instanceof HTMLTextAreaElement)) {
    throw new Error("textarea not found");
  }
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(textareaNode),
      "value",
    )?.set;
    valueSetter?.call(textareaNode, value);
    textareaNode.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  const formNode = container.querySelector("form");
  if (!(formNode instanceof HTMLFormElement)) {
    throw new Error("form not found");
  }
  await act(async () => {
    formNode.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

describe("ConversationList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state initially", async () => {
    vi.mocked(api.GET).mockImplementation(() => new Promise(() => undefined));
    const { container, root } = render(createElement(ConversationList));
    await act(async () => {
      root.render(createElement(ConversationList));
    });
    expect(container.textContent).toContain("Loading");
    root.unmount();
  });

  it("renders received conversations", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { conversations: [{ id: "conv-1", kind: "direct", createdAt: "2026-01-01T00:00:00Z", members: ["a", "b"] }] },
      error: undefined,
      response: new Response(),
    });
    const { container, root } = render(createElement(ConversationList));
    await act(async () => {
      root.render(createElement(ConversationList));
    });
    await flush();
    expect(container.textContent).toContain("conv-1");
    root.unmount();
  });

  it("shows an empty state", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { conversations: [] },
      error: undefined,
      response: new Response(),
    });
    const { container, root } = render(createElement(ConversationList));
    await act(async () => {
      root.render(createElement(ConversationList));
    });
    await flush();
    expect(container.textContent).toContain("No conversations");
    root.unmount();
  });

  it("requests /conversations through the typed client", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { conversations: [] },
      error: undefined,
      response: new Response(),
    });
    const { root } = render(createElement(ConversationList));
    await act(async () => {
      root.render(createElement(ConversationList));
    });
    await flush();
    expect(api.GET).toHaveBeenCalledWith("/conversations", expect.anything());
    root.unmount();
  });
});

describe("MessageComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.POST).mockResolvedValue({
      data: { messageId: "m1" },
      error: undefined,
      response: new Response(),
    });
  });

  it("shows the demo / not E2EE label", async () => {
    const { container, root } = render(createElement(MessageComposer));
    await act(async () => {
      root.render(createElement(MessageComposer));
    });
    expect(container.textContent).toContain("demo / not E2EE");
    root.unmount();
  });

  it("submits a placeholder envelope payload", async () => {
    const { container, root } = render(createElement(MessageComposer, { recipientDeviceId: "11111111-1111-4111-8111-111111111111" }));
    await act(async () => {
      root.render(createElement(MessageComposer, { recipientDeviceId: "11111111-1111-4111-8111-111111111111" }));
    });
    await typeAndSubmit(container, "hello");
    expect(api.POST).toHaveBeenCalledWith(
      "/mailbox",
      expect.objectContaining({
        body: expect.objectContaining({
          recipientDeviceId: "11111111-1111-4111-8111-111111111111",
          envelope: "aGVsbG8=",
          expiry: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        }),
      }),
    );
    root.unmount();
  });

  it("keeps Ghost Mode on and writes nothing to local storage when sending", async () => {
    expect(GHOST_MODE_DEFAULT).toBe(true);
    expect(isGhostModeEnabled(undefined)).toBe(true);
    const localSpy = vi.spyOn(localStorage, "setItem");
    const sessionSpy = vi.spyOn(sessionStorage, "setItem");
    const { container, root } = render(createElement(MessageComposer));
    await act(async () => {
      root.render(createElement(MessageComposer));
    });
    await typeAndSubmit(container, "hello");
    expect(api.POST).toHaveBeenCalledWith("/mailbox", expect.anything());
    expect(localSpy).not.toHaveBeenCalled();
    expect(sessionSpy).not.toHaveBeenCalled();
    localSpy.mockRestore();
    sessionSpy.mockRestore();
    root.unmount();
  });
});

describe("derivePlaceholderEnvelope", () => {
  it("base64-encodes UTF-8 input (known-answer vector)", () => {
    expect(derivePlaceholderEnvelope("hello")).toBe("aGVsbG8=");
  });
});

describe("MailboxPoll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state initially", async () => {
    vi.mocked(api.GET).mockImplementation(() => new Promise(() => undefined));
    const { container, root } = render(createElement(MailboxPoll));
    await act(async () => {
      root.render(createElement(MailboxPoll));
    });
    expect(container.textContent).toContain("Loading");
    root.unmount();
  });

  it("shows an empty state", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { messages: [] },
      error: undefined,
      response: new Response(),
    });
    const { container, root } = render(createElement(MailboxPoll));
    await act(async () => {
      root.render(createElement(MailboxPoll));
    });
    await flush();
    expect(container.textContent).toContain("No messages");
    root.unmount();
  });

  it("renders received envelopes", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { messages: [{ id: "msg-1", recipientDeviceId: "r", conversationId: null, senderDeviceId: "s", envelope: "ZW52", enqueuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T01:00:00Z", status: "queued" }] },
      error: undefined,
      response: new Response(),
    });
    const { container, root } = render(createElement(MailboxPoll));
    await act(async () => {
      root.render(createElement(MailboxPoll));
    });
    await flush();
    expect(container.textContent).toContain("msg-1");
    expect(container.textContent).toContain("ZW52");
    root.unmount();
  });

  it("requests /mailbox through the typed client", async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { messages: [] },
      error: undefined,
      response: new Response(),
    });
    const { root } = render(createElement(MailboxPoll));
    await act(async () => {
      root.render(createElement(MailboxPoll));
    });
    await flush();
    expect(api.GET).toHaveBeenCalledWith("/mailbox", expect.anything());
    root.unmount();
  });
});

describe("SafetyNumberPanel", () => {
  it("reports unverified status without a false claim", async () => {
    const { container, root } = render(createElement(SafetyNumberPanel));
    await act(async () => {
      root.render(createElement(SafetyNumberPanel));
    });
    expect(container.textContent).toContain("not yet verified");
    expect(container.textContent).toContain("unverified");
    root.unmount();
  });
});