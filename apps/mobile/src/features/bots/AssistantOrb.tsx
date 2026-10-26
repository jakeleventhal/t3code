import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { Keyboard, Platform, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { FloatingActionButton } from "../../components/ui/FloatingActionButton";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { botRole, botThreadStatus } from "./bot-room";
import { useBotCallSummary } from "./use-bot-call";
import { useAssistantEnvironmentId, useAssistantProject } from "./use-assistant";

const SIZE = 44;
/** Chats' primary action, sized like the compose circle and Material's standard FAB. */
export const PROMINENT_ASSISTANT_ORB_SIZE = 56;

/**
 * Opens the quick chat with the user's one Assistant over whatever Code is showing, whichever
 * environment that work is on. Null while there is no Assistant to open.
 */
export function useOpenAssistantQuick(): (() => void) | null {
  const environmentId = useAssistantEnvironmentId();
  const navigation = useNavigation();
  const call = useBotCallSummary();
  const open = useCallback(() => {
    if (environmentId === null) return;
    Keyboard.dismiss();
    navigation.navigate("AssistantQuick", { environmentId: String(environmentId) });
  }, [environmentId, navigation]);
  return environmentId === null || (call !== null && call.phase !== "failed") ? null : open;
}

/**
 * The quick Assistant for a thread's own views, such as its browser or review. Null for a bot's
 * chat, which is already a conversation, and while the thread's project is still unknown.
 */
export function useThreadAssistant(ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): (() => void) | null {
  const open = useOpenAssistantQuick();
  const projectId = useQuietThreadShell(ref)?.projectId ?? null;
  const project = useProject(
    projectId === null ? null : { environmentId: ref.environmentId, projectId },
  );
  return project !== null && botRole(project) === null ? open : null;
}

/**
 * The Assistant's way into Code. A dot appears only while its main conversation is working or
 * waiting on the user. The caller positions it; it is always absolutely placed. `prominent` is
 * Chats' primary action; elsewhere it stays a quiet glass button beside the page's own controls.
 */
export function AssistantOrb(props: {
  readonly style: StyleProp<ViewStyle>;
  readonly prominent?: boolean;
}) {
  const environmentId = useAssistantEnvironmentId();
  const open = useOpenAssistantQuick();
  const project = useAssistantProject(environmentId);
  const { colors } = useControlTheme();
  const mainThreadId = project?.botMainThreadId ?? null;
  const mainThread = useQuietThreadShell(
    environmentId === null || mainThreadId === null
      ? null
      : { environmentId, threadId: mainThreadId },
  );
  const status = mainThread === null ? null : botThreadStatus(mainThread);
  const label =
    status === "needs-you"
      ? "Assistant, needs you"
      : status === "working"
        ? "Assistant, working"
        : "Assistant";
  const size = props.prominent ? PROMINENT_ASSISTANT_ORB_SIZE : SIZE;
  if (open === null) return null;
  const button = !props.prominent ? (
    <GlassSurface style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens a quick chat with your Assistant"
        onPress={open}
        className="flex-1 items-center justify-center"
      >
        <SymbolView name="sparkles" size={20} tintColorClassName="accent-primary" />
      </Pressable>
    </GlassSurface>
  ) : Platform.OS === "android" ? (
    <FloatingActionButton icon="sparkles" label={label} tone="primary" onPress={open} />
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens a quick chat with your Assistant"
      onPress={open}
      className="items-center justify-center rounded-full bg-primary shadow-lg active:opacity-80"
      style={{ width: size, height: size }}
    >
      <SymbolView name="sparkles" size={26} tintColorClassName="accent-primary-foreground" />
    </Pressable>
  );
  return (
    <View pointerEvents="box-none" className="absolute" style={props.style}>
      {button}
      {status === null ? null : (
        <View
          pointerEvents="none"
          className={
            props.prominent
              ? "absolute right-0.5 top-0.5 size-3.5 rounded-full border-2 border-screen"
              : "absolute right-0 top-0 size-3 rounded-full border-2 border-screen"
          }
          style={{
            backgroundColor:
              status === "needs-you"
                ? colors["--color-warning-foreground"]
                : colors["--color-primary-text"],
          }}
        />
      )}
    </View>
  );
}
