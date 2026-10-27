import { formatModelSlugName } from "./model.ts";
import type { OrchestrationV2Subagent } from "@t3tools/contracts";
import type {
  BotSharedPreferences,
  ProjectId,
  ServerSettings,
  VoiceSelection,
} from "@t3tools/contracts";

export function botComplexTaskModel(
  preferences: BotSharedPreferences,
  projectId: ProjectId | null,
) {
  return (
    (projectId === null ? undefined : preferences.complexTaskModelOverrides?.[projectId]) ??
    preferences.complexTaskModelSelection ??
    null
  );
}

/** Account identifiers are local. Only the voice and provider kind travel between machines. */
export function localBotVoice(
  settings: ServerSettings,
  voice: NonNullable<BotSharedPreferences["defaultVoice"]>,
): VoiceSelection {
  const connections = Object.entries(settings.voiceConnections);
  const match =
    connections.find(
      ([id, connection]) => id === voice.connectionId && connection.kind === voice.connectionKind,
    ) ?? connections.find(([, connection]) => connection.kind === voice.connectionKind);
  return {
    connectionId: match?.[0] ?? `unavailable:${voice.connectionKind}`,
    model: voice.model,
    voice: voice.voice,
  };
}

export function botDefaultVoice(settings: ServerSettings): VoiceSelection | null {
  const voice = settings.botSharedPreferences.defaultVoice;
  return voice === undefined
    ? settings.voiceSelection
    : voice === null
      ? null
      : localBotVoice(settings, voice);
}

export function botVoiceSelection(settings: ServerSettings, projectId: ProjectId) {
  const shared = settings.botSharedPreferences.voiceOverrides?.[projectId];
  if (shared !== undefined && shared !== "inherit") {
    return {
      kind: "own" as const,
      selection: shared === null ? null : localBotVoice(settings, shared),
    };
  }
  const legacy = settings.projectSettingsOverrides[projectId]?.voiceSelection;
  if (
    settings.botSharedPreferences.voiceOverrides === undefined &&
    shared !== "inherit" &&
    legacy !== undefined
  )
    return { kind: "own" as const, selection: legacy };
  return { kind: "default" as const, selection: botDefaultVoice(settings) };
}

/**
 * Every model a bot reaches without being asked: its chat and complex-task choices, their
 * per-bot overrides, and the automatic picks used when those are unavailable.
 */
export function botRoutedModels(
  preferences: BotSharedPreferences,
  projectId: ProjectId | null,
): ReadonlySet<string> {
  const runtime = projectId === null ? undefined : preferences.runtimeOverrides?.[projectId];
  return new Set(
    [
      botComplexTaskModel(preferences, projectId),
      preferences.defaultModelSelection,
      runtime?.modelSelection,
      preferences.automaticModelSelections?.chat,
      preferences.automaticModelSelections?.complex,
    ].flatMap((selection) => (selection ? [selection.model] : [])),
  );
}

/**
 * Running work on a model the user named for it. Ordinary routing, including quiet escalation
 * to the complex-task model, stays unlabeled.
 */
export function explicitBotTaskModels(
  agents: readonly OrchestrationV2Subagent[],
  routed: ReadonlySet<string>,
): string[] {
  return activeBotTaskModels(
    agents.filter((agent) => {
      const model = agent.modelSelection?.model ?? agent.model;
      return model !== undefined && model !== null && !routed.has(model);
    }),
  );
}

export function activeBotTaskModels(agents: readonly OrchestrationV2Subagent[]): string[] {
  return [
    ...new Set(
      agents
        .filter((agent) => ["pending", "running", "waiting"].includes(agent.status))
        .flatMap((agent) => {
          const model = agent.modelSelection?.model ?? agent.model;
          if (!model) return [];
          const effort = agent.modelSelection?.options?.find((option) =>
            ["effort", "reasoningEffort", "reasoning_effort"].includes(option.id),
          )?.value;
          return [
            `${formatModelSlugName(model)}${typeof effort === "string" ? ` · ${effort[0]?.toUpperCase()}${effort.slice(1)}` : ""}`,
          ];
        }),
    ),
  ];
}
