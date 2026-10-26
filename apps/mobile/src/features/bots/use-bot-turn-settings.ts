import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  botDefaultsPatch,
  botModelUnavailableReason,
  botRuntimeSettingsUpdateMessage,
  botTurnOverridePatch,
  supportsBotRuntimeSettings,
} from "@t3tools/client-runtime/bot-turn-settings";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { useState } from "react";

import { buildModelOptions } from "../../lib/modelOptions";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import {
  botFollowedLabel,
  botModelLabel,
  botRuntimeModeLabel,
  botTurnSettingLabel,
  botTurnSettings,
} from "./bot-turn-settings";

/** `null` returns a setting to what it follows; an absent key leaves it alone. */
export interface BotTurnSettingsChange {
  readonly modelSelection?: ModelSelection | null;
  readonly runtimeMode?: RuntimeMode | null;
}

/**
 * The model and permissions one bot, or the bot defaults when `projectId` is null, use for the
 * next turn on an environment, with labels and a writer. Changes never reach work already running.
 */
export function useBotTurnSettings(environmentId: EnvironmentId, projectId: ProjectId | null) {
  const config = useEnvironmentServerConfig(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const configureBots = useAtomCommand(botEnvironment.configure);
  const [pending, setPending] = useState(false);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const sources = botTurnSettings(settings, projectId);
  const model = sources.model.own ?? sources.model.inherited;
  const modelOptions = buildModelOptions(config, model, undefined, projectId);
  const forBot = projectId !== null;
  const labelModel = (selection: ModelSelection) => botModelLabel(modelOptions, selection);
  const supported =
    config !== null &&
    config.environment.capabilities.botConversations === true &&
    (projectId === null || config.environment.capabilities.projectSettingsOverrides === true);
  // An older server would save the rest of the patch and drop these, so show them read-only.
  const editable = supported && supportsBotRuntimeSettings(config?.environment.capabilities);

  const save = async (change: BotTurnSettingsChange) => {
    if (config === null || !editable) return;
    // The latest settings, so a change saved since this render isn't written back over.
    const latest =
      appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.settings ?? settings;
    const patch =
      projectId === null
        ? botDefaultsPatch(latest, {
            ...(change.modelSelection === undefined
              ? {}
              : { defaultModelSelection: change.modelSelection }),
            ...(change.runtimeMode === undefined ? {} : { defaultRuntimeMode: change.runtimeMode }),
          })
        : botTurnOverridePatch(latest, projectId, change);
    setPending(true);
    if (projectId === null && patch.botDefaults) {
      await configureBots({ environmentId, input: patch.botDefaults });
    } else if (projectId)
      await configureBots({ environmentId, input: { runtimeOverride: { projectId, ...change } } });
    setPending(false);
  };

  return {
    config,
    supported,
    editable,
    /** Why the settings are read-only on this server; null when they can be changed. */
    updateMessage:
      supported && !editable && config !== null
        ? botRuntimeSettingsUpdateMessage(config.environment.label)
        : null,
    canWrite,
    pending,
    sources,
    modelOptions,
    /** Why the model this setting resolves to can't run here; null when it can or isn't set. */
    setupNeeded:
      config !== null && model !== null
        ? botModelUnavailableReason(settings, projectId, model, config.providers)
        : null,
    modelLabel: botTurnSettingLabel(sources.model, labelModel, forBot),
    runtimeModeLabel: botTurnSettingLabel(sources.runtimeMode, botRuntimeModeLabel, forBot),
    /** What "Use default" returns to. */
    followedModelLabel: botFollowedLabel(sources.model, labelModel),
    followedRuntimeModeLabel: botFollowedLabel(sources.runtimeMode, botRuntimeModeLabel),
    save,
  };
}
