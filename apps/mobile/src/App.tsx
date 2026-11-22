import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { PaperProvider, Text } from "react-native-paper";
import { Ionicons } from "@expo/vector-icons";
import { appTheme } from "./theme.ts";
import { api } from "./lib/api.ts";
import { ChatScreen } from "./screens/ChatScreen.tsx";

/**
 * Health status returned by the typed client.
 */
type HealthState = "loading" | "ok" | "error";

/**
 * Root component for the SHAT mobile app.
 */
export function App(): ReactElement {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.GET("/health", { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        setHealth(response.data?.status === "ok" ? "ok" : "error");
      } catch {
        if (controller.signal.aborted) {
          return;
        }
        setHealth("error");
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <PaperProvider theme={appTheme}>
      <SafeAreaProvider>
        <SafeAreaView>
          <Text variant="headlineMedium">SHAT</Text>
          <Ionicons
            name="shield-checkmark"
            size={24}
            color={appTheme.colors.primary}
            accessible={false}
          />
          <Text>Health: {health}</Text>
          <ChatScreen />
        </SafeAreaView>
      </SafeAreaProvider>
    </PaperProvider>
  );
}
