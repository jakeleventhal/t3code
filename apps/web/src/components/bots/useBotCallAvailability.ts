import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { botVoiceEnvironment, useEnvironmentSupportsBotVoice } from "../../state/botVoice";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { resolveBotCallAvailability, type BotCallAvailability } from "./botCall.logic";

/**
 * Reads the bot's voice from settings already on the client, so a header never fetches the
 * catalog just to render. A null `projectId` is a bot that doesn't exist yet and would get the
 * environment's default voice.
 */
export function useBotCallAvailability(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
): BotCallAvailability {
  const supported = useEnvironmentSupportsBotVoice(environmentId);
  const connected = useConnectedEnvironmentIds().includes(environmentId);
  const canCall = useAtomValue(botVoiceEnvironment.begin.permissionAtom(environmentId));
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const selection =
    settings === null ? null : resolveProjectSettings(settings, projectId).settings.voiceSelection;
  return resolveBotCallAvailability({
    supported,
    connected: connected && settings !== null,
    canCall,
    selection,
    connection:
      selection === null || settings === null
        ? undefined
        : settings.voiceConnections[selection.connectionId],
  });
}
