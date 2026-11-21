/**
 * Chat screen for the mobile app.
 *
 * Uses the typed API client and the Ghost controller. Message content is
 * kept in memory only while Ghost Mode is on.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AppState, View } from "react-native";
import { Button, Text, TextInput } from "react-native-paper";
import { api } from "../lib/api.ts";
import { isConversationListResponse } from "../lib/messaging.ts";
import type { LoadState } from "../lib/messaging.ts";
import { GhostModeController } from "../ghost/controller.ts";

const DEFAULT_RECIPIENT_DEVICE_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Chat screen component.
 */
export function ChatScreen(): ReactElement {
  const [state, setState] = useState<LoadState>("loading");
  const [conversations, setConversations] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const ghostRef = useRef<GhostModeController | null>(null);
  if (ghostRef.current === null) {
    ghostRef.current = new GhostModeController();
  }
  const ghost = ghostRef.current;
  const sendControllerRef = useRef<AbortController | null>(null);
  const prevSelectedRef = useRef<string | null>(null);

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
        const ids = isConversationListResponse(raw)
          ? raw.conversations.map((conversation) => conversation.id)
          : [];
        if (!controller.signal.aborted) {
          setConversations(ids);
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

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        ghost.dispose();
      }
    });
    return () => {
      subscription.remove();
      sendControllerRef.current?.abort();
      ghost.dispose();
    };
  }, [ghost]);

  useEffect(() => {
    if (prevSelectedRef.current !== null && prevSelectedRef.current !== selected) {
      ghost.closeConversation(prevSelectedRef.current);
    }
    prevSelectedRef.current = selected;
  }, [selected, ghost]);

  async function handleSend(): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || sending) {
      return;
    }
    setSending(true);
    setStatus(null);
    const controller = new AbortController();
    sendControllerRef.current = controller;
    try {
      const body = {
        recipientDeviceId: DEFAULT_RECIPIENT_DEVICE_ID,
        envelope: trimmed,
        expiry: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        ...(selected !== null ? { conversationId: selected } : {}),
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
      ghost.store(selected ?? "default", trimmed);
      if (!controller.signal.aborted) {
        setText("");
        setStatus("Sent.");
      }
    } catch {
      if (!controller.signal.aborted) {
        setStatus("Send failed.");
      }
    } finally {
      sendControllerRef.current = null;
      if (!controller.signal.aborted) {
        setSending(false);
      }
    }
  }

  return (
    <View>
      <Text variant="headlineMedium" accessibilityRole="header">
        Conversations
      </Text>
      {state === "loading" ? (
        <Text accessibilityLabel="Loading conversations">Loading…</Text>
      ) : null}
      {state === "error" ? (
        <Text accessibilityLabel="Conversations error">Could not load.</Text>
      ) : null}
      {conversations.map((id) => (
        <Button
          key={id}
          mode={selected === id ? "contained" : "outlined"}
          onPress={() => setSelected(id)}
          accessibilityLabel={`Select conversation ${id}`}
        >
          {id}
        </Button>
      ))}
      <TextInput
        label="Message"
        value={text}
        onChangeText={setText}
        accessibilityLabel="Message body"
      />
      <Button
        mode="contained"
        onPress={() => void handleSend()}
        disabled={sending || text.trim().length === 0}
        accessibilityLabel="Send message"
      >
        {sending ? "Sending…" : "Send"}
      </Button>
      {status !== null ? <Text accessibilityRole="status">{status}</Text> : null}
    </View>
  );
}
