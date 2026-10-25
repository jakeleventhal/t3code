import {
  type EnvironmentId,
  type ExecutionEnvironmentCapabilities,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import { readCustomModelEntries } from "@t3tools/shared/model";
import { resolveBotTurnSettings } from "@t3tools/shared/projectSettings";

/** Where a bot's model comes from: its own override, the bot defaults, or the existing fallback. */
export type BotTurnSettingsSource = "bot" | "defaults" | "inherited";

export type BotTurnReadiness =
  | {
      readonly kind: "ready";
      readonly modelSelection: ModelSelection;
      readonly runtimeMode: RuntimeMode;
      readonly source: BotTurnSettingsSource;
    }
  | {
      readonly kind: "setup-needed";
      readonly modelSelection: ModelSelection;
      readonly runtimeMode: RuntimeMode;
      readonly source: Exclude<BotTurnSettingsSource, "inherited">;
      readonly instanceId: ProviderInstanceId;
      readonly reason: string;
    };

type BotTurnSettingsInput = Pick<
  ServerSettings,
  "botDefaults" | "projectSettingsOverrides" | "providerInstances"
>;

function providerLabel(provider: ServerProvider | undefined, instanceId: ProviderInstanceId) {
  return provider?.displayName ?? instanceId;
}

/**
 * Why the configured model can't run here, or null when it can. Warning and error statuses still
 * pass: they are often transient, and the server reports them on the turn itself.
 */
export function botModelUnavailableReason(
  settings: BotTurnSettingsInput,
  projectId: ProjectId | null,
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): string | null {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const label = providerLabel(provider, selection.instanceId);
  if (
    provider === undefined ||
    provider.availability === "unavailable" ||
    !provider.installed ||
    provider.status === "disabled" ||
    !provider.enabled ||
    !resolveProjectProviderInstanceEnabled(settings, projectId, selection.instanceId)
  ) {
    return `${label} isn’t set up on this environment.`;
  }
  const config = settings.providerInstances[selection.instanceId]?.config;
  const customModels = readCustomModelEntries(
    config !== null && typeof config === "object"
      ? (config as Record<string, unknown>).customModels
      : undefined,
  );
  // Providers that list no models choose them at runtime.
  if (
    provider.models.length > 0 &&
    !provider.models.some(
      (model) => model.slug === selection.model || model.aliases?.includes(selection.model),
    ) &&
    !customModels.some((model) => model.slug === selection.model)
  ) {
    return `${selection.model} isn’t available from ${label}.`;
  }
  return null;
}

/**
 * The model and permissions a bot's next turn uses. A configured model that can't run here is
 * reported, never swapped for another; only the inherited fallback keeps its existing handling.
 * `projectId` is null for a bot that doesn't exist yet, which only follows the bot defaults.
 */
export function resolveBotTurnReadiness(input: {
  readonly settings: BotTurnSettingsInput;
  readonly projectId: ProjectId | null;
  readonly fallback: { readonly modelSelection: ModelSelection; readonly runtimeMode: RuntimeMode };
  readonly providers: ReadonlyArray<ServerProvider>;
}): BotTurnReadiness {
  const { settings, projectId, fallback, providers } = input;
  const resolved =
    projectId === null
      ? {
          modelSelection: settings.botDefaults.defaultModelSelection ?? fallback.modelSelection,
          runtimeMode: settings.botDefaults.defaultRuntimeMode ?? fallback.runtimeMode,
        }
      : resolveBotTurnSettings(settings, projectId, fallback);
  const source: BotTurnSettingsSource =
    projectId !== null && settings.projectSettingsOverrides[projectId]?.defaultModelSelection
      ? "bot"
      : settings.botDefaults.defaultModelSelection
        ? "defaults"
        : "inherited";
  if (source === "inherited") return { kind: "ready", ...resolved, source };
  const reason = botModelUnavailableReason(settings, projectId, resolved.modelSelection, providers);
  return reason === null
    ? { kind: "ready", ...resolved, source }
    : {
        kind: "setup-needed",
        ...resolved,
        source,
        instanceId: resolved.modelSelection.instanceId,
        reason,
      };
}

/**
 * Sets or clears one bot's own model and permissions. `null` returns that setting to the bot
 * defaults; an absent key leaves it alone. Unrelated project overrides are kept.
 */
export function botTurnOverridePatch(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectId: ProjectId,
  change: {
    readonly modelSelection?: ModelSelection | null;
    readonly runtimeMode?: RuntimeMode | null;
  },
): ServerSettingsPatch {
  const { defaultModelSelection, defaultRuntimeMode, ...rest } =
    settings.projectSettingsOverrides[projectId] ?? {};
  const modelSelection =
    change.modelSelection === undefined ? defaultModelSelection : change.modelSelection;
  const runtimeMode = change.runtimeMode === undefined ? defaultRuntimeMode : change.runtimeMode;
  const next = {
    ...rest,
    ...(modelSelection ? { defaultModelSelection: modelSelection } : {}),
    ...(runtimeMode ? { defaultRuntimeMode: runtimeMode } : {}),
  };
  return {
    projectSettingsOverrides: { [projectId]: Object.keys(next).length === 0 ? null : next },
  };
}

/** The patch carries the whole object, so the other default survives. */
export function botDefaultsPatch(
  settings: Pick<ServerSettings, "botDefaults">,
  change: {
    readonly defaultModelSelection?: ModelSelection | null;
    readonly defaultRuntimeMode?: RuntimeMode | null;
  },
): ServerSettingsPatch {
  return { botDefaults: { ...settings.botDefaults, ...change } };
}

/**
 * Older servers decode a settings patch without the bot keys and save the rest, so bot defaults,
 * per-bot settings and the default host stay read-only until the server says it applies them.
 */
export function supportsBotRuntimeSettings(
  capabilities: Pick<ExecutionEnvironmentCapabilities, "botRuntimeSettings"> | null | undefined,
): boolean {
  return capabilities?.botRuntimeSettings === true;
}

export function botRuntimeSettingsUpdateMessage(environmentLabel: string): string {
  return `Update ${environmentLabel}’s T3 Code server to change bot settings. Its version would ignore them.`;
}

export interface BotHostCandidate {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly supportsBots: boolean;
}

export type NewBotHost =
  | { readonly kind: "ready"; readonly environmentId: EnvironmentId; readonly label: string }
  | {
      readonly kind: "unavailable";
      readonly environmentId: EnvironmentId;
      readonly label: string;
      readonly reason: string;
    };

/**
 * Where a new bot is created: the default host saved on the environment hosting Assistant, else
 * that environment. An unreachable default is reported, never swapped for whichever is online.
 */
export function resolveNewBotHost(input: {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly defaultBotEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<BotHostCandidate>;
}): NewBotHost {
  const environmentId = input.defaultBotEnvironmentId ?? input.sourceEnvironmentId;
  const candidate = input.environments.find((entry) => entry.environmentId === environmentId);
  if (candidate === undefined) {
    return {
      kind: "unavailable",
      environmentId,
      label: "The default host",
      reason: "The default host for new bots isn’t connected to this device.",
    };
  }
  const { label } = candidate;
  if (!candidate.connected) {
    return { kind: "unavailable", environmentId, label, reason: `${label} is offline.` };
  }
  if (!candidate.supportsBots) {
    return {
      kind: "unavailable",
      environmentId,
      label,
      reason: `${label}’s T3 Code server doesn’t support bots yet.`,
    };
  }
  return { kind: "ready", environmentId, label };
}
