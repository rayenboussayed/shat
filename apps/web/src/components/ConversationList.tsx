import { createElement, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { LoadState } from "../lib/messaging.ts";
import { isConversationListResponse } from "../lib/messaging.ts";
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
  },
  status: {
    marginTop: tokens.spacingSmall,
  },
});

/**
 * Fetches and renders the conversation list from GET /conversations.
 *
 * @returns The rendered conversation list with loading and empty states.
 */
export function ConversationList() {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<readonly string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = await api.GET("/conversations", {
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
        const payload = isConversationListResponse(raw) ? raw : undefined;
        if (controller.signal.aborted) {
          return;
        }
        if (!controller.signal.aborted) {
          setItems((payload?.conversations ?? []).map((conversation) => conversation.id));
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
    return createElement("p", { role: "status" }, "Loading conversations…");
  }
  if (state === "error") {
    return createElement("p", { role: "alert" }, "Could not load conversations.");
  }
  if (items.length === 0) {
    return createElement("p", { role: "status" }, "No conversations yet.");
  }
  return createElement(
    "ul",
    { ...stylex.props(styles.list), "aria-label": "Conversations" },
    ...items.map((id) =>
      createElement("li", { ...stylex.props(styles.item), key: id }, id),
    ),
  );
}
