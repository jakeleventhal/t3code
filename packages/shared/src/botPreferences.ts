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
  if (shared !== "inherit" && legacy !== undefined)
    return { kind: "own" as const, selection: legacy };
  return { kind: "default" as const, selection: botDefaultVoice(settings) };
}
