import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { Keyboard, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { botRole, botThreadStatus } from "./bot-room";
import { useAssistantProject } from "./use-assistant";

const SIZE = 44;

/** Opens the quick Assistant chat for one environment, over whatever Code is showing. */
export function useOpenAssistantQuick(environmentId: EnvironmentId | null) {
  const navigation = useNavigation();
  return useCallback(() => {
    if (environmentId === null) return;
    Keyboard.dismiss();
    navigation.navigate("AssistantQuick", { environmentId: String(environmentId) });
  }, [environmentId, navigation]);
}

/**
 * The quick Assistant for a thread's own views, such as its browser or review. Null for a bot's
 * chat, which is already a conversation, and while the thread's project is still unknown.
 */
export function useThreadAssistant(ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): (() => void) | null {
  const open = useOpenAssistantQuick(ref.environmentId);
  const projectId = useQuietThreadShell(ref)?.projectId ?? null;
  const project = useProject(
    projectId === null ? null : { environmentId: ref.environmentId, projectId },
  );
  return project !== null && botRole(project) === null ? open : null;
}

/**
 * The Assistant's quiet way into Code. A dot appears only while its main conversation is working
 * or waiting on the user. The caller positions it; it is always absolutely placed.
 */
export function AssistantOrb(props: {
  readonly environmentId: EnvironmentId;
  readonly style: StyleProp<ViewStyle>;
}) {
  const open = useOpenAssistantQuick(props.environmentId);
  const project = useAssistantProject(props.environmentId);
  const mainThreadId = project?.botMainThreadId ?? null;
  const mainThread = useQuietThreadShell(
    mainThreadId === null ? null : { environmentId: props.environmentId, threadId: mainThreadId },
  );
  const status = mainThread === null ? null : botThreadStatus(mainThread);
  return (
    <View pointerEvents="box-none" className="absolute" style={props.style}>
      <GlassSurface style={{ width: SIZE, height: SIZE, borderRadius: SIZE / 2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            status === "needs-you"
              ? "Assistant, needs you"
              : status === "working"
                ? "Assistant, working"
                : "Assistant"
          }
          accessibilityHint="Opens a quick chat with your Assistant"
          onPress={open}
          className="flex-1 items-center justify-center"
        >
          <SymbolView name="sparkles" size={20} tintColorClassName="accent-primary" />
        </Pressable>
      </GlassSurface>
      {status === null ? null : (
        <View
          pointerEvents="none"
          className={
            status === "needs-you"
              ? "absolute right-0 top-0 size-3 rounded-full border-2 border-screen bg-warning"
              : "absolute right-0 top-0 size-3 rounded-full border-2 border-screen bg-primary"
          }
        />
      )}
    </View>
  );
}
