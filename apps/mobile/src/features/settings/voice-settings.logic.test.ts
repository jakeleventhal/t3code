import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  type ProjectId,
  type ProviderInstanceId,
  type ServerSettings,
  type VoiceCatalog,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botVoiceSource,
  firstVoiceSelection,
  subscriptionVoiceSources,
  voiceConnectionPatch,
  voiceConnectionsSignature,
  voiceSelectionLabel,
} from "./voice-settings.logic";

const bot = "bot" as ProjectId;
const marin = { connectionId: "openai-api", model: "realtime", voice: "marin" };
const cedar = { connectionId: "openai-api", model: "realtime", voice: "cedar" };

function settings(patch: Partial<ServerSettings>): ServerSettings {
  return { ...DEFAULT_SERVER_SETTINGS, ...patch };
}

describe("botVoiceSource", () => {
  it("follows the environment default when the bot has no override", () => {
    expect(botVoiceSource(settings({ voiceSelection: marin }), bot)).toEqual({
      kind: "default",
      selection: marin,
    });
  });

  it("keeps a bot's own voice over the default", () => {
    const value = settings({
      voiceSelection: marin,
      projectSettingsOverrides: { [bot]: { voiceSelection: cedar } },
    });
    expect(botVoiceSource(value, bot)).toEqual({ kind: "own", selection: cedar });
  });

  it("treats a stored null as the bot's own choice of no voice", () => {
    const value = settings({
      voiceSelection: marin,
      projectSettingsOverrides: { [bot]: { voiceSelection: null } },
    });
    expect(botVoiceSource(value, bot)).toEqual({ kind: "own", selection: null });
  });
});

describe("voiceSelectionLabel", () => {
  const catalog: VoiceCatalog = {
    connections: [
      {
        id: "openai-api",
        kind: "openai-api",
        name: "Work key",
        status: "configured",
        reason: null,
        models: [{ id: "realtime", label: "Realtime", voices: [{ id: "marin", label: "Marin" }] }],
      },
    ],
  };

  it("names the voice and connection from the catalog", () => {
    expect(voiceSelectionLabel(catalog, marin)).toBe("Marin · Work key");
  });

  it("does not invent a label for a voice the catalog no longer offers", () => {
    expect(voiceSelectionLabel(catalog, cedar)).toBe("Unavailable voice · Work key");
    expect(voiceSelectionLabel(catalog, { ...marin, connectionId: "gone" })).toBe(
      "Missing connection",
    );
  });
});

describe("unusable connections", () => {
  const models = [{ id: "realtime", label: "Realtime", voices: [{ id: "marin", label: "Marin" }] }];
  const needsKey = {
    id: "openai-api",
    kind: "openai-api" as const,
    name: "Work key",
    status: "missing-credentials" as const,
    reason: null,
    models,
  };
  const subscription = {
    id: "chatgpt",
    kind: "codex-subscription" as const,
    name: "ChatGPT",
    status: "unavailable" as const,
    reason:
      "Choose an existing Codex CLI account signed in with ChatGPT. Managed token-sharing accounts do not provide subscription voice.",
    models,
  };

  it("can't be newly picked even though the catalog still lists their voices", () => {
    expect(firstVoiceSelection(needsKey)).toBeNull();
    expect(firstVoiceSelection(subscription)).toBeNull();
    expect(firstVoiceSelection({ ...needsKey, status: "configured" })).toEqual(marin);
  });

  it("keeps a saved pick visible and says why it won't work", () => {
    expect(voiceSelectionLabel({ connections: [needsKey] }, marin)).toBe(
      "Marin · Work key · Needs a key",
    );
  });
});

describe("voiceConnectionPatch", () => {
  const saved = { kind: "openai-api" as const, name: "Work key", apiKey: "••••••" };

  it("sends the saved key's redaction marker back when the key field is left empty", () => {
    expect(
      voiceConnectionPatch({
        kind: "openai-api",
        name: "Renamed",
        apiKeyDraft: "",
        existing: saved,
        providerInstanceId: null,
      }),
    ).toEqual({ kind: "openai-api", name: "Renamed", apiKey: "••••••" });
  });

  it("requires a key for a new API connection", () => {
    expect(
      voiceConnectionPatch({
        kind: "xai-api",
        name: "",
        apiKeyDraft: " ",
        existing: null,
        providerInstanceId: null,
      }),
    ).toBeNull();
  });

  it("links a subscription connection to a Codex instance without a key", () => {
    expect(
      voiceConnectionPatch({
        kind: "codex-subscription",
        name: "",
        apiKeyDraft: "",
        existing: null,
        providerInstanceId: "codex" as ProviderInstanceId,
      }),
    ).toEqual({
      kind: "codex-subscription",
      name: "ChatGPT subscription",
      providerInstanceId: "codex",
    });
  });
});

describe("voiceConnectionsSignature", () => {
  const key = { kind: "openai-api" as const, name: "Work key", apiKey: "sk-secret" };

  it("changes when a key is added or removed but never contains the key", () => {
    const withKey = voiceConnectionsSignature({ work: key });
    expect(withKey).not.toContain("sk-secret");
    expect(voiceConnectionsSignature({ work: { ...key, apiKey: "" } })).not.toBe(withKey);
    expect(voiceConnectionsSignature({ work: { ...key, apiKey: "sk-other" } })).toBe(withKey);
  });

  it("ignores record order", () => {
    const other = { kind: "xai-api" as const, name: "Grok", apiKey: "" };
    expect(voiceConnectionsSignature({ work: key, grok: other })).toBe(
      voiceConnectionsSignature({ grok: other, work: key }),
    );
  });
});

describe("subscriptionVoiceSources", () => {
  it("offers only enabled Codex instances that use their own CLI login", () => {
    const codex = ProviderDriverKind.make("codex");
    const sources = subscriptionVoiceSources(
      settings({
        providerInstances: {
          ["personal" as ProviderInstanceId]: { driver: codex, displayName: "Personal" },
          ["shared" as ProviderInstanceId]: { driver: codex, config: { setupMode: "managed" } },
          ["off" as ProviderInstanceId]: { driver: codex, enabled: false },
          ["paused" as ProviderInstanceId]: { driver: codex, config: { enabled: false } },
          ["claude" as ProviderInstanceId]: { driver: ProviderDriverKind.make("claudeAgent") },
        },
      }),
    );
    expect(sources).toEqual([
      { id: "codex", label: "Codex 1" },
      { id: "personal", label: "Personal" },
    ]);
  });
});

it("offers the default Codex subscription before any provider settings are saved", () => {
  expect(subscriptionVoiceSources(settings({}))).toContainEqual({ id: "codex", label: "Codex 1" });
});
