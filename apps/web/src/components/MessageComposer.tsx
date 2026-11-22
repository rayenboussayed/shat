import { createElement, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { DEMO_ENVELOPE_LABEL, derivePlaceholderEnvelope } from "../lib/envelope.ts";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex.ts";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingSmall,
    marginTop: tokens.spacingMedium,
  },
  label: {
    fontWeight: 600,
  },
  textarea: {
    minHeight: "5rem",
    padding: tokens.spacingSmall,
    border: "1px solid #d1d5db",
    borderRadius: tokens.radiusMedium,
    fontFamily: "inherit",
  },
  button: {
    alignSelf: "flex-start",
    padding: `${tokens.spacingSmall} ${tokens.spacingMedium}`,
    border: "none",
    borderRadius: tokens.radiusMedium,
    backgroundColor: tokens.colorAccent,
    color: "#ffffff",
    cursor: "pointer",
    ":focus-visible": {
      outline: "2px solid #1d4ed8",
      outlineOffset: "2px",
    },
  },
  demo: {
    color: "#b45309",
    fontWeight: 600,
  },
  note: {
    marginTop: tokens.spacingSmall,
  },
  status: {
    marginTop: tokens.spacingSmall,
  },
});

/** Placeholder recipient used only when none is supplied (demo mode). */
const DEFAULT_RECIPIENT_DEVICE_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Props for {@link MessageComposer}.
 */
export interface MessageComposerProps {
  readonly recipientDeviceId?: string;
  readonly conversationId?: string;
}

/**
 * Composer that submits a placeholder (non-E2EE) placeholder envelope.
 *
 * @param props - Optional recipient and conversation identifiers.
 * @returns The rendered composer form.
 */
export function MessageComposer(props: MessageComposerProps) {
  const recipientDeviceId = props.recipientDeviceId ?? DEFAULT_RECIPIENT_DEVICE_ID;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || sending) {
      return;
    }
    setSending(true);
    setStatus(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const envelope = derivePlaceholderEnvelope(trimmed);
      const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const body = {
        recipientDeviceId,
        envelope,
        expiry,
        ...(props.conversationId !== undefined
          ? { conversationId: props.conversationId }
          : {}),
      };
      const { error } = await api.POST("/mailbox", {
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      if (error !== undefined) {
        if (!controller.signal.aborted) {
          setStatus("Send failed.");
        }
        return;
      }
      if (!controller.signal.aborted) {
        setText("");
        setStatus("Sent (demo / not E2EE).");
      }
    } catch {
      if (!controller.signal.aborted) {
        setStatus("Send failed.");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setSending(false);
      }
    }
  }

  return createElement(
    "form",
    { ...stylex.props(styles.form), onSubmit: handleSubmit, "aria-label": "Message composer" },
    createElement(
      "label",
      { ...stylex.props(styles.label), htmlFor: "message-body" },
      "Message (demo, not encrypted)",
    ),
    createElement("textarea", {
      id: "message-body",
      ...stylex.props(styles.textarea),
      value: text,
      onChange: (event: { target: { value: string } }) => setText(event.target.value),
    }),
    createElement(
      "p",
      { ...stylex.props(styles.demo) },
      DEMO_ENVELOPE_LABEL,
    ),
    createElement(
      "p",
      { ...stylex.props(styles.note) },
      "Ghost Mode avoids local storage only. Sending stores this envelope on the server.",
    ),
    createElement(
      "button",
      {
        type: "submit",
        ...stylex.props(styles.button),
        disabled: sending || text.trim().length === 0,
      },
      sending ? "Sending…" : "Send",
    ),
    status !== null
      ? createElement("p", { ...stylex.props(styles.status), role: "status" }, status)
      : null,
  );
}