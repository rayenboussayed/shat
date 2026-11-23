import { createElement } from "react";
import { isConversationListResponse } from "shat-api-types";
import { api } from "../lib/api.ts";
import { useApiGet } from "../lib/use-api-get.ts";
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
    borderBottomWidth: tokens.borderWidthThin,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorBorder,
  },
  status: {
    marginTop: tokens.spacingSmall,
  },
});

/**
 * Issues the conversation-list GET with the hook-managed abort signal.
 *
 * @param signal - Signal aborted when the list unmounts.
 * @returns The typed client response.
 */
function requestConversations(signal: AbortSignal) {
  return api.GET("/conversations", { signal });
}

/**
 * Validates and maps a conversation-list body to the rendered id list.
 *
 * @param raw - The untrusted response body.
 * @returns The conversation ids, or an empty list when the body is malformed.
 */
function mapConversations(raw: unknown): readonly string[] {
  const payload = isConversationListResponse(raw) ? raw : undefined;
  return (payload?.conversations ?? []).map((conversation) => conversation.id);
}

/**
 * Fetches and renders the conversation list from GET /conversations.
 *
 * @returns The rendered conversation list with loading and empty states.
 */
export function ConversationList() {
  const { state, value } = useApiGet(requestConversations, mapConversations);

  if (state === "loading") {
    return createElement("p", { role: "status" }, "Loading conversations…");
  }
  if (state === "error") {
    return createElement("p", { role: "alert" }, "Could not load conversations.");
  }
  if (value === undefined || value.length === 0) {
    return createElement("p", { role: "status" }, "No conversations yet.");
  }
  return createElement(
    "ul",
    { ...stylex.props(styles.list), "aria-label": "Conversations" },
    ...value.map((id) =>
      createElement("li", { ...stylex.props(styles.item), key: id }, id),
    ),
  );
}
