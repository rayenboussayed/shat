import { createElement, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { LoadState, MailboxMessage } from "../lib/messaging.ts";
import { isMailboxPollResponse } from "../lib/messaging.ts";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex.ts";

const styles = stylex.create({
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  item: {
    padding: tokens.spacingSmall,
    borderBottom: "1px solid #e5e7eb",
    fontFamily: "monospace",
    wordBreak: "break-all",
  },
  status: {
    marginTop: tokens.spacingSmall,
  },
});

/**
 * Polls GET /mailbox and renders received envelopes with loading and empty states.
 *
 * @returns The rendered mailbox view.
 */
export function MailboxPoll() {
  const [state, setState] = useState<LoadState>("loading");
  const [messages, setMessages] = useState<readonly MailboxMessage[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = await api.GET("/mailbox", {
          params: { query: { limit: 50 } },
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        if (error !== undefined || data === undefined) {
          if (!controller.signal.aborted) {
            setState("error");
          }
          return;
        }
        const raw: unknown = data;
        const payload = isMailboxPollResponse(raw) ? raw : undefined;
        if (controller.signal.aborted) {
          return;
        }
        if (!controller.signal.aborted) {
          setMessages(payload?.messages ?? []);
          setState("ready");
        }
      } catch {
        if (!controller.signal.aborted) {
          setState("error");
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  if (state === "loading") {
    return createElement("p", { role: "status" }, "Loading mailbox…");
  }
  if (state === "error") {
    return createElement("p", { role: "alert" }, "Could not load mailbox.");
  }
  if (messages.length === 0) {
    return createElement("p", { role: "status" }, "No messages received.");
  }
  return createElement(
    "ul",
    { ...stylex.props(styles.list), "aria-label": "Received messages" },
    ...messages.map((message) =>
      createElement(
        "li",
        { ...stylex.props(styles.item), key: message.id },
        `${message.id}: ${message.envelope}`,
      ),
    ),
  );
}
