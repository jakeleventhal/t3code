import type {
  ProjectId,
  ServerSettings,
  ServerSettingsPatch,
  VoiceCatalog,
  VoiceConnection,
  VoiceSelection,
} from "@t3tools/contracts";
import {
  clearProjectSettingsOverrides,
  resolveProjectSettings,
} from "@t3tools/shared/projectSettings";

export type VoiceCatalogConnection = VoiceCatalog["connections"][number];
export type VoiceConnectionKind = VoiceConnection["kind"];

export const VOICE_CONNECTION_KIND_LABELS: Readonly<Record<VoiceConnectionKind, string>> = {
  "openai-api": "OpenAI API",
  "xai-api": "xAI API",
  "codex-subscription": "ChatGPT subscription",
};

export function voiceSelectionKey(selection: VoiceSelection): string {
  return JSON.stringify([selection.connectionId, selection.model, selection.voice]);
}

export function parseVoiceSelectionKey(key: string): VoiceSelection | null {
  try {
    const value: unknown = JSON.parse(key);
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every((part) => typeof part === "string" && part.length > 0)
    ) {
      const [connectionId, model, voice] = value as [string, string, string];
      return { connectionId, model, voice };
    }
  } catch {
    // Not a voice key.
  }
  return null;
}

export interface VoiceOptionGroup {
  readonly key: string;
  readonly label: string;
  readonly voices: ReadonlyArray<{ readonly key: string; readonly label: string }>;
}

/** Only connections with a saved key offer voices; the rest can't be picked until fixed. */
export function voiceOptionGroups(catalog: VoiceCatalog | null): readonly VoiceOptionGroup[] {
  if (catalog === null) return [];
  return catalog.connections.flatMap((connection) =>
    connection.status !== "configured"
      ? []
      : connection.models.map((model) => ({
          key: `${connection.id}:${model.id}`,
          label: `${connection.name} · ${model.label}`,
          voices: model.voices.map((voice) => ({
            key: voiceSelectionKey({
              connectionId: connection.id,
              model: model.id,
              voice: voice.id,
            }),
            label: voice.label,
          })),
        })),
  );
}

export type VoiceSelectionIssue = "connection-removed" | "connection-unusable" | "voice-removed";

export interface VoiceSelectionDescription {
  readonly label: string;
  readonly detail: string | null;
  readonly issue: VoiceSelectionIssue | null;
}

export function describeVoiceSelection(
  selection: VoiceSelection | null,
  catalog: VoiceCatalog | null,
): VoiceSelectionDescription {
  if (selection === null) return { label: "No voice", detail: null, issue: null };
  // Until the catalog arrives the saved ids are all there is; they aren't a problem yet.
  if (catalog === null) return { label: selection.voice, detail: null, issue: null };
  const connection = catalog.connections.find(
    (candidate) => candidate.id === selection.connectionId,
  );
  if (connection === undefined) {
    return {
      label: selection.voice,
      detail: "Its voice account was removed.",
      issue: "connection-removed",
    };
  }
  const model = connection.models.find((candidate) => candidate.id === selection.model);
  const voice = model?.voices.find((candidate) => candidate.id === selection.voice);
  if (connection.status !== "configured") {
    return {
      label: voice?.label ?? selection.voice,
      detail: `${connection.name}: ${connection.reason ?? "Not ready."}`,
      issue: "connection-unusable",
    };
  }
  if (model === undefined || voice === undefined) {
    return {
      label: selection.voice,
      detail: `${connection.name} no longer offers this voice.`,
      issue: "voice-removed",
    };
  }
  return { label: voice.label, detail: `${connection.name} · ${model.label}`, issue: null };
}

export type BotVoice =
  | { readonly kind: "default"; readonly selection: VoiceSelection | null }
  | { readonly kind: "own"; readonly selection: VoiceSelection | null };

/** A project override, even one set to null, is the bot's own choice; anything else follows the default. */
export function resolveBotVoice(settings: ServerSettings, projectId: ProjectId): BotVoice {
  const resolved = resolveProjectSettings(settings, projectId);
  return {
    kind: resolved.sources.voiceSelection === "project" ? "own" : "default",
    selection: resolved.settings.voiceSelection,
  };
}

/** `undefined` removes the override so the bot follows the default again. */
export function botVoiceOverridePatch(
  settings: ServerSettings,
  projectId: ProjectId,
  selection: VoiceSelection | null | undefined,
): ServerSettingsPatch {
  return {
    projectSettingsOverrides: {
      [projectId]:
        selection === undefined
          ? clearProjectSettingsOverrides(settings, projectId, ["voiceSelection"])
          : { ...settings.projectSettingsOverrides[projectId], voiceSelection: selection },
    },
  };
}

export function voiceConnectionStatus(connection: VoiceCatalogConnection | undefined): {
  readonly label: string;
  readonly variant: "outline" | "warning";
} {
  switch (connection?.status) {
    case undefined:
      return { label: "Checking", variant: "outline" };
    // A saved key or linked sign-in is all the server knows; it hasn't been tried on a call.
    case "configured":
      return {
        label: connection.kind === "codex-subscription" ? "Sign-in linked" : "Key saved",
        variant: "outline",
      };
    case "missing-credentials":
      return { label: "No key", variant: "warning" };
    case "unavailable":
      return { label: "Unavailable", variant: "warning" };
  }
}

/** Who loses their voice when this account is removed, for the confirmation. */
export function voiceConnectionUsers(
  settings: ServerSettings,
  connectionId: string,
  bots: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>,
): { readonly usedByDefault: boolean; readonly botTitles: readonly string[] } {
  return {
    usedByDefault: settings.voiceSelection?.connectionId === connectionId,
    botTitles: bots
      .filter((bot) => {
        const voice = resolveBotVoice(settings, bot.id);
        return voice.kind === "own" && voice.selection?.connectionId === connectionId;
      })
      .map((bot) => bot.title),
  };
}
