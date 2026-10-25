import { voiceProviderInstances } from "@t3tools/shared/voiceProviderInstances";
import {
  VoiceConnectionError,
  type ProjectId,
  type ProviderInstanceId,
  type ServerSettingsError,
  type VoiceCatalog,
  type VoiceSelection,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { subscriptionVoiceConfig } from "./CodexVoice.ts";

import * as ServerSettings from "../serverSettings.ts";

// These are provider-published built-ins, not account entitlements. Keeping the
// catalog local lets users configure voice without making a billable session.
// https://developers.openai.com/api/docs/guides/live-conversations
const liveVoiceIds = [
  "marin",
  "quartz",
  "ripple",
  "vesper",
  "willow",
  "stone",
  "gleam",
  "meridian",
  "bossa",
  "tempo",
  "beacon",
  "delta",
  "cinder",
  "nuri",
  "juni",
  "flitz",
  "brise",
  "sillage",
  "nira",
  "harema",
  "shida",
  "noeul",
];
// Speech-to-speech shares this roster with TTS:
// https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#voices
const grokVoiceIds = [
  "eve",
  "ara",
  "leo",
  "rex",
  "sal",
  "carina",
  "zagan",
  "helix",
  "orion",
  "luna",
  "iris",
  "altair",
  "zenith",
  "perseus",
  "helios",
  "lux",
  "kepler",
  "rigel",
  "cosmo",
  "celeste",
  "ursa",
  "sirius",
  "lumen",
  "castor",
  "naksh",
  "atlas",
  "aurora",
  "liora",
];
const options = (ids: ReadonlyArray<string>) =>
  ids.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
const liveModels = [{ id: "gpt-live-1", label: "GPT Live", voices: options(liveVoiceIds) }];
const subscriptionModels = [
  {
    id: "gpt-live-subscription",
    label: "GPT Live",
    voices: options([
      "alloy",
      "arbor",
      "ash",
      "aube",
      "ballad",
      "breeze",
      "bubbie",
      "cedar",
      "coral",
      "cove",
      "echo",
      "ember",
      "haetsal",
      "hanul",
      "himari",
      "juniper",
      "leher",
      "maple",
      "marin",
      "miko",
      "neer",
      "porto",
      "rindo",
      "rio",
      "rivage",
      "sage",
      "selva",
      "shimmer",
      "sol",
      "sonna",
      "spruce",
      "tinta",
      "vale",
      "verse",
      "viola",
    ]),
  },
];
const grokModels = [
  { id: "grok-voice-3.0", label: "Grok Voice 3.0", voices: options(grokVoiceIds) },
];

export class VoiceConfiguration extends Context.Service<
  VoiceConfiguration,
  {
    readonly catalog: () => Effect.Effect<VoiceCatalog, ServerSettingsError>;
    readonly resolve: (
      projectId: ProjectId,
    ) => Effect.Effect<
      { readonly selection: VoiceSelection } & (
        | { readonly kind: "openai-api" | "xai-api"; readonly apiKey: Redacted.Redacted<string> }
        | { readonly kind: "codex-subscription"; readonly providerInstanceId: ProviderInstanceId }
      ),
      VoiceConnectionError
    >;
    readonly resolveSelection: (
      selection: VoiceSelection,
    ) => Effect.Effect<
      { readonly selection: VoiceSelection } & (
        | { readonly kind: "openai-api" | "xai-api"; readonly apiKey: Redacted.Redacted<string> }
        | { readonly kind: "codex-subscription"; readonly providerInstanceId: ProviderInstanceId }
      ),
      VoiceConnectionError
    >;
  }
>()("t3/bots/VoiceConfiguration") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const catalog = Effect.fn("VoiceConfiguration.catalog")(function* () {
    const current = yield* settings.getSettings;
    return {
      connections: Object.entries(current.voiceConnections).map(([id, connection]) => {
        if (connection.kind === "codex-subscription") {
          const available =
            subscriptionVoiceConfig(
              voiceProviderInstances(current)[connection.providerInstanceId],
            ) !== null;
          return {
            id,
            kind: connection.kind,
            name: connection.name,
            status: available ? ("configured" as const) : ("unavailable" as const),
            reason: available
              ? null
              : "Choose an existing Codex CLI account signed in with ChatGPT. Managed token-sharing accounts do not provide subscription voice.",
            models: available ? subscriptionModels : [],
          };
        }
        const hasKey = connection.apiKey.trim().length > 0;
        return {
          id,
          kind: connection.kind,
          name: connection.name,
          status: hasKey ? ("configured" as const) : ("missing-credentials" as const),
          reason: hasKey ? null : "Add an API key to this voice account.",
          models: connection.kind === "openai-api" ? liveModels : grokModels,
        };
      }),
    };
  });
  const resolveSelection = Effect.fn("VoiceConfiguration.resolveSelection")(function* (
    selection: VoiceSelection,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => new VoiceConnectionError({ reason: "storage", cause })),
    );
    const connection = current.voiceConnections[selection.connectionId];
    if (connection?.kind === "codex-subscription") {
      if (
        subscriptionVoiceConfig(voiceProviderInstances(current)[connection.providerInstanceId]) ===
          null ||
        !subscriptionModels.some(
          (model) =>
            model.id === selection.model &&
            model.voices.some((voice) => voice.id === selection.voice),
        )
      )
        return yield* new VoiceConnectionError({ reason: "unavailable" });
      return {
        selection,
        kind: connection.kind,
        providerInstanceId: connection.providerInstanceId,
      };
    }
    if (!connection || !connection.apiKey.trim()) {
      return yield* new VoiceConnectionError({ reason: "unavailable" });
    }
    const models = connection.kind === "openai-api" ? liveModels : grokModels;
    if (
      !models.some(
        (model) =>
          model.id === selection.model &&
          model.voices.some((voice) => voice.id === selection.voice),
      )
    ) {
      return yield* new VoiceConnectionError({ reason: "unavailable" });
    }
    return { selection, kind: connection.kind, apiKey: Redacted.make(connection.apiKey) };
  });
  const resolve = Effect.fn("VoiceConfiguration.resolve")(function* (projectId: ProjectId) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => new VoiceConnectionError({ reason: "storage", cause })),
    );
    const selection = resolveProjectSettings(current, projectId).settings.voiceSelection;
    if (selection === null) return yield* new VoiceConnectionError({ reason: "not-configured" });
    return yield* resolveSelection(selection);
  });
  return VoiceConfiguration.of({ catalog, resolve, resolveSelection });
});

export const layer = Layer.effect(VoiceConfiguration, make);
