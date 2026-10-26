import {
  resolveBotTurnReadiness,
  type BotHostCandidate,
  type BotTurnReadiness,
} from "@t3tools/client-runtime/bot-turn-settings";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ServerConfig,
  ServerSettings,
} from "@t3tools/contracts";

import type { ModelOption } from "../../lib/modelOptions";
import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";
import { botRole } from "./bot-room";

type BotTurnSettingsSettings = Pick<ServerSettings, "botDefaults" | "projectSettingsOverrides">;

/**
 * One bot setting as its editor shows it: the value chosen here, and what applies when nothing
 * is. For a bot, the fallback is the bot defaults. For the bot defaults themselves (`projectId`
 * null) the shared defaults have not been configured yet.
 */
export interface BotTurnSetting<T> {
  readonly own: T | null;
  readonly inherited: T | null;
}

export function botTurnSettings(
  settings: BotTurnSettingsSettings,
  projectId: ProjectId | null,
): {
  readonly model: BotTurnSetting<ModelSelection>;
  readonly runtimeMode: BotTurnSetting<RuntimeMode>;
} {
  const defaults = settings.botDefaults;
  if (projectId === null) {
    return {
      model: { own: defaults.defaultModelSelection, inherited: null },
      runtimeMode: { own: defaults.defaultRuntimeMode, inherited: null },
    };
  }
  const own = settings.projectSettingsOverrides[projectId];
  return {
    model: { own: own?.defaultModelSelection ?? null, inherited: defaults.defaultModelSelection },
    runtimeMode: { own: own?.defaultRuntimeMode ?? null, inherited: defaults.defaultRuntimeMode },
  };
}

export function botModelLabel(
  options: ReadonlyArray<ModelOption>,
  selection: ModelSelection,
): string {
  const option = options.find(
    (entry) =>
      entry.selection.instanceId === selection.instanceId &&
      entry.selection.model === selection.model,
  );
  return option ? `${option.label} · ${option.providerLabel}` : selection.model;
}

export function botRuntimeModeLabel(mode: RuntimeMode): string {
  return RUNTIME_MODE_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode;
}

/** What a setting follows when it has no value of its own. */
export function botFollowedLabel<T>(
  setting: BotTurnSetting<T>,
  label: (value: T) => string,
): string {
  return setting.inherited === null ? "Not configured" : label(setting.inherited);
}

/** What a row shows for a setting: its own value, or what it follows, marked as such. */
export function botTurnSettingLabel<T>(
  setting: BotTurnSetting<T>,
  label: (value: T) => string,
  forBot: boolean,
): string {
  if (setting.own !== null) return label(setting.own);
  return forBot
    ? `Use default · ${botFollowedLabel(setting, label)}`
    : botFollowedLabel(setting, label);
}

/**
 * What a chat's next message runs on when the chat belongs to a bot with a model chosen in its
 * settings or the bot defaults. Null keeps the chat's own settings: not a bot, nothing chosen, or
 * no config to read yet.
 */
export function botChatTurn(input: {
  readonly config: Pick<ServerConfig, "settings" | "providers"> | null | undefined;
  readonly project: Pick<EnvironmentProject, "id" | "botRole"> | null;
  readonly fallback: { readonly modelSelection: ModelSelection; readonly runtimeMode: RuntimeMode };
}): BotTurnReadiness | null {
  const { config, project } = input;
  if (!config || project === null || botRole(project) === null) return null;
  const readiness = resolveBotTurnReadiness({
    settings: config.settings,
    projectId: project.id,
    fallback: input.fallback,
    providers: config.providers,
  });
  return readiness.source === "inherited" ? null : readiness;
}

/** An environment this device knows, as the Assistant's environment list describes it. */
export interface KnownBotEnvironment {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly isEnabled: boolean;
  readonly connectionState: string;
  readonly supportsBots: boolean;
}

export function botHostCandidates(
  environments: ReadonlyArray<KnownBotEnvironment>,
): ReadonlyArray<BotHostCandidate> {
  return environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.environmentLabel,
    connected: environment.isEnabled && environment.connectionState === "connected",
    supportsBots: environment.supportsBots,
  }));
}

export interface BotHostChoice {
  /** Null keeps new bots on the environment the setting is saved on. */
  readonly value: EnvironmentId | null;
  readonly label: string;
  readonly status: string | null;
  readonly selected: boolean;
}

/**
 * The default host choices saved on one environment: itself, then every other environment this
 * device knows. A saved host this device doesn't know still shows, selected, so it isn't lost.
 */
export function botHostChoices(input: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly stored: EnvironmentId | null;
  readonly candidates: ReadonlyArray<BotHostCandidate>;
}): ReadonlyArray<BotHostChoice> {
  const { environmentId, stored } = input;
  const others = input.candidates.filter((candidate) => candidate.environmentId !== environmentId);
  const choices: Array<BotHostChoice> = [
    {
      value: null,
      label: `This environment (${input.label})`,
      status: null,
      selected: stored === null || stored === environmentId,
    },
    ...others.map((candidate) => ({
      value: candidate.environmentId,
      label: candidate.label,
      status: !candidate.connected
        ? "Offline"
        : candidate.supportsBots
          ? null
          : "Needs a newer T3 Code server",
      selected: stored === candidate.environmentId,
    })),
  ];
  if (stored !== null && !choices.some((choice) => choice.selected)) {
    choices.push({
      value: stored,
      label: "Not connected to this device",
      status: null,
      selected: true,
    });
  }
  return choices;
}
