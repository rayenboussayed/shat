import { createElement } from "react";
import type { MailboxMessage } from "shat-api-types";
import { isMailboxPollResponse } from "shat-api-types";
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
    fontFamily: "monospace",
    wordBreak: "break-all",
  },
  status: {
    marginTop: tokens.spacingSmall,
  },
});

/**
 * Issues the mailbox GET with the hook-managed abort signal.
 *
 * @param signal - Signal aborted when the mailbox view unmounts.
 * @returns The typed client response.
 */
function requestMailbox(signal: AbortSignal) {
  return api.GET("/mailbox", {
    params: { query: { limit: 50 } },
    signal,
  });
}

/**
 * Validates and maps a mailbox body to the rendered message list.
 *
 * @param raw - The untrusted response body.
 * @returns The messages, or an empty list when the body is malformed.
 */
function mapMessages(raw: unknown): readonly MailboxMessage[] {
  const payload = isMailboxPollResponse(raw) ? raw : undefined;
  return payload?.messages ?? [];
}

/**
 * Polls GET /mailbox and renders received envelopes with loading and empty states.
 *
 * @returns The rendered mailbox view.
 */
export function MailboxPoll() {
  const { state, value } = useApiGet(requestMailbox, mapMessages);

  if (state === "loading") {
    return createElement("p", { role: "status" }, "Loading mailbox…");
  }
  if (state === "error") {
    return createElement("p", { role: "alert" }, "Could not load mailbox.");
  }
  if (value === undefined || value.length === 0) {
    return createElement("p", { role: "status" }, "No messages received.");
  }
  return createElement(
    "ul",
    { ...stylex.props(styles.list), "aria-label": "Received messages" },
    ...value.map((message) =>
      createElement(
        "li",
        { ...stylex.props(styles.item), key: message.id },
        `${message.id}: ${message.envelope}`,
      ),
    ),
  );
}
