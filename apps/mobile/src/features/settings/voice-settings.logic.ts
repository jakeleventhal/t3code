import { voiceProviderInstances } from "@t3tools/shared/voiceProviderInstances";
import {
  resolveProviderInstanceEnabled,
  type ProjectId,
  type ProviderInstanceId,
  type ServerSettings,
  type VoiceCatalog,
  type VoiceConnection,
  type VoiceSelection,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

export type VoiceCatalogConnection = VoiceCatalog["connections"][number];
export type VoiceConnectionKind = VoiceConnection["kind"];

export const VOICE_CONNECTION_KINDS: ReadonlyArray<{
  readonly kind: VoiceConnectionKind;
  readonly label: string;
  readonly description: string;
}> = [
  {
    kind: "openai-api",
    label: "OpenAI API key",
    description: "Billed by OpenAI to this key.",
  },
  {
    kind: "xai-api",
    label: "xAI API key",
    description: "Billed by xAI to this key. Your Grok sign-in isn't used for voice.",
  },
  {
    kind: "codex-subscription",
    label: "ChatGPT subscription",
    description: "Uses an existing Codex login with ChatGPT on this environment.",
  },
];

export function voiceConnectionKindLabel(kind: VoiceConnectionKind): string {
  return VOICE_CONNECTION_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;
}

/**
 * What a saved voice choice means for calls, so a choice never reads as ready where it isn't.
 * Whether one account can call is the catalog's status and reason, so a `kind` adds nothing
 * beyond the ChatGPT sign-in caveat the catalog can't know until a call connects.
 */
export function voiceCallsNote(input: {
  readonly callsSupported: boolean;
  readonly kind?: VoiceConnectionKind;
}): string | undefined {
  if (!input.callsSupported) {
    return "This environment can't place voice calls yet. Choices here are saved for when it can.";
  }
  if (input.kind === undefined) {
    return "Calls use OpenAI API, xAI API, or ChatGPT subscription voices. A change applies to the next call, not one in progress.";
  }
  return input.kind === "codex-subscription"
    ? "Uses an existing Codex CLI login signed in with ChatGPT, checked when a call connects. Accounts added with Connect with ChatGPT can't provide voice."
    : undefined;
}

/**
 * Mirrors the server's subscription voice eligibility: an enabled Codex instance using its own
 * CLI login. Connect with ChatGPT sharing accounts can't open subscription voice.
 */
export function subscriptionVoiceSources(
  settings: ServerSettings,
): ReadonlyArray<{ readonly id: ProviderInstanceId; readonly label: string }> {
  return Object.entries(voiceProviderInstances(settings)).flatMap(([id, instance]) => {
    const config = instance.config;
    const managed =
      config !== null &&
      typeof config === "object" &&
      "setupMode" in config &&
      config.setupMode === "managed";
    return instance.driver === "codex" && resolveProviderInstanceEnabled(instance) && !managed
      ? [{ id: id as ProviderInstanceId, label: instance.displayName ?? id }]
      : [];
  });
}

/** `configured` means the saved setup is eligible; nothing has placed a call with it yet. */
export function voiceConnectionStatusLabel(connection: VoiceCatalogConnection): string {
  switch (connection.status) {
    case "configured":
      return connection.kind === "codex-subscription" ? "Sign-in linked" : "Key saved";
    case "missing-credentials":
      return connection.kind === "codex-subscription" ? "Needs a sign-in" : "Needs a key";
    case "unavailable":
      return "Unavailable";
  }
}

export function voiceSelectionLabel(
  catalog: VoiceCatalog | null,
  selection: VoiceSelection | null,
): string {
  if (selection === null) return "Not set";
  const connection = catalog?.connections.find((entry) => entry.id === selection.connectionId);
  if (!connection) return catalog === null ? "Loading…" : "Missing connection";
  const model = connection.models.find((entry) => entry.id === selection.model);
  const voice = model?.voices.find((entry) => entry.id === selection.voice);
  const label = voice
    ? `${voice.label} · ${connection.name}`
    : `Unavailable voice · ${connection.name}`;
  return isVoiceConnectionUsable(connection)
    ? label
    : `${label} · ${voiceConnectionStatusLabel(connection)}`;
}

/** The catalog still publishes models for an account without a key, but nothing can use them. */
export function isVoiceConnectionUsable(connection: VoiceCatalogConnection): boolean {
  return connection.status === "configured";
}

/** The first voice a connection offers, for when someone picks the connection before a voice. */
export function firstVoiceSelection(connection: VoiceCatalogConnection): VoiceSelection | null {
  if (!isVoiceConnectionUsable(connection)) return null;
  for (const model of connection.models) {
    const voice = model.voices[0];
    if (voice) return { connectionId: connection.id, model: model.id, voice: voice.id };
  }
  return null;
}

export type BotVoiceSource =
  | { readonly kind: "default"; readonly selection: VoiceSelection | null }
  | { readonly kind: "own"; readonly selection: VoiceSelection | null };

/** An absent project override follows the environment default; a stored null is the bot's own "none". */
export function botVoiceSource(settings: ServerSettings, projectId: ProjectId): BotVoiceSource {
  const resolved = resolveProjectSettings(settings, projectId);
  return {
    kind: resolved.sources.voiceSelection === "project" ? "own" : "default",
    selection: resolved.settings.voiceSelection,
  };
}

/**
 * What the catalog derives from saved connections. Key presence stands in for the key, so the
 * signature never carries a secret, even a redacted one.
 */
export function voiceConnectionsSignature(
  connections: Readonly<Record<string, VoiceConnection>>,
): string {
  return JSON.stringify(
    Object.entries(connections)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, connection]) =>
        connection.kind === "codex-subscription"
          ? [id, connection.kind, connection.name, connection.providerInstanceId]
          : [id, connection.kind, connection.name, connection.apiKey !== ""],
      ),
  );
}

/**
 * Settings carry a saved key back as the server's redaction marker, and sending that marker
 * keeps the stored secret. An empty draft therefore means "keep", not "clear".
 */
export function voiceConnectionPatch(input: {
  readonly kind: VoiceConnectionKind;
  readonly name: string;
  readonly apiKeyDraft: string;
  readonly existing: VoiceConnection | null;
  readonly providerInstanceId: ProviderInstanceId | null;
}): VoiceConnection | null {
  const name = input.name.trim() || voiceConnectionKindLabel(input.kind);
  if (input.kind === "codex-subscription") {
    if (input.providerInstanceId === null) return null;
    return { kind: input.kind, name, providerInstanceId: input.providerInstanceId };
  }
  const draft = input.apiKeyDraft.trim();
  const kept =
    input.existing?.kind === input.kind && "apiKey" in input.existing ? input.existing.apiKey : "";
  const apiKey = draft || kept;
  if (!apiKey) return null;
  return { kind: input.kind, name, apiKey };
}
