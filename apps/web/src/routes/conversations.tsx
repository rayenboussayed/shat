import { createElement } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ConversationList } from "../components/ConversationList.tsx";
import { MessageComposer } from "../components/MessageComposer.tsx";
import { MailboxPoll } from "../components/MailboxPoll.tsx";
import { SafetyNumberPanel } from "../components/SafetyNumberPanel.tsx";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex.ts";

const styles = stylex.create({
  shell: {
    padding: tokens.spacingMedium,
    fontFamily: "system-ui, sans-serif",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
  },
});

/**
 * Conversations route: lists conversations, composes demo messages, polls the
 * mailbox and shows the safety-number panel.
 */
export function ConversationsComponent() {
  return createElement(
    "main",
    { ...stylex.props(styles.shell) },
    createElement("h1", { ...stylex.props(styles.title) }, "Conversations"),
    createElement(ConversationList),
    createElement(MessageComposer),
    createElement(MailboxPoll),
    createElement(SafetyNumberPanel),
  );
}

/** Route definition for /conversations. */
export const Route = createFileRoute("/conversations")({
  component: ConversationsComponent,
});