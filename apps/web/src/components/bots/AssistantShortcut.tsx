import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { resolveShortcutCommand } from "../../keybindings";
import { isEditableFocused } from "../../lib/editableFocus";
import { isPreviewFocused } from "../../lib/previewFocus";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { readProjects } from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { isSettingsPath, partitionEnvironmentBots } from "./botRoom.logic";
import { useBotRoomStore } from "./botRoomStore";
import { useHasVoiceCall } from "../../voice/useVoiceCall";
import { useBotActions } from "./useBotActions";
import { useAppRoom, useAssistantEnvironmentId, useBotsEnvironmentId } from "./useBotRoom";

/**
 * In Code, Assistant answers in the quick panel on the environment being worked in. In Bots it
 * opens as the full chat, as it does from Settings and during a call, when the quick panel isn't
 * shown.
 */
export function useAssistantCommands() {
  const room = useAppRoom();
  const onSettings = useLocation({ select: (location) => isSettingsPath(location.pathname) });
  const botsEnvironmentId = useBotsEnvironmentId();
  const codeEnvironmentId = useAssistantEnvironmentId();
  const environmentId = room === "bots" ? botsEnvironmentId : codeEnvironmentId;
  const onCall = useHasVoiceCall();
  const quickPanel = room === "code" && !onSettings && !onCall;
  const { openMainConversation } = useBotActions();

  const openChat = () => {
    if (environmentId === null) return;
    const { assistant } = partitionEnvironmentBots(readProjects(), environmentId);
    useBotRoomStore.getState().setAssistantPanelOpen(false);
    void openMainConversation(environmentId, assistant, { fromCode: quickPanel });
  };
  const toggle = () => {
    if (environmentId === null) return;
    if (!quickPanel) {
      openChat();
      return;
    }
    const { assistantPanelOpen, setAssistantPanelOpen } = useBotRoomStore.getState();
    setAssistantPanelOpen(!assistantPanelOpen);
  };
  return { available: environmentId !== null, toggle, openChat };
}

export function AssistantShortcut() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggle } = useAssistantCommands();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          previewFocus: isPreviewFocused(),
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "assistant.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    // A focused desktop browser page forwards the chord back as a menu action.
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "assistant.toggle") toggle();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [keybindings, toggle]);

  return null;
}
