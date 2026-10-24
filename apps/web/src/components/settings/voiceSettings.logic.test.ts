import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type ProjectSettingsOverrides,
  type ServerSettings,
  type VoiceCatalog,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botVoiceOverridePatch,
  describeVoiceSelection,
  parseVoiceSelectionKey,
  resolveBotVoice,
  voiceConnectionUsers,
  voiceOptionGroups,
  voiceSelectionKey,
} from "./voiceSettings.logic";

const fitness = ProjectId.make("fitness");
const finance = ProjectId.make("finance");
const marin = { connectionId: "openai", model: "gpt-live-1", voice: "marin" };
const rex = { connectionId: "xai", model: "grok-voice-3.0", voice: "rex" };

const catalog: VoiceCatalog = {
  connections: [
    {
      id: "openai",
      kind: "openai-api",
      name: "OpenAI API",
      status: "configured",
      reason: null,
      models: [{ id: "gpt-live-1", label: "GPT Live", voices: [{ id: "marin", label: "Marin" }] }],
    },
    {
      id: "xai",
      kind: "xai-api",
      name: "xAI API",
      status: "missing-credentials",
      reason: "Add an API key to this voice account.",
      models: [
        { id: "grok-voice-3.0", label: "Grok Voice 3.0", voices: [{ id: "rex", label: "Rex" }] },
      ],
    },
  ],
};

const fitnessOverride: ProjectSettingsOverrides = {
  voiceSelection: rex,
  responseStreamingMode: "turn",
};
const financeOverride: ProjectSettingsOverrides = { voiceSelection: null };

const settings: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  voiceSelection: marin,
  projectSettingsOverrides: { [fitness]: fitnessOverride, [finance]: financeOverride },
};

describe("voice selection keys", () => {
  it("round-trips ids that contain separators", () => {
    const selection = { connectionId: "a:b", model: "m|1", voice: "v,2" };
    expect(parseVoiceSelectionKey(voiceSelectionKey(selection))).toEqual(selection);
    expect(parseVoiceSelectionKey("inherit")).toBeNull();
  });
});

describe("voiceOptionGroups", () => {
  it("offers voices only from accounts with a saved key", () => {
    expect(voiceOptionGroups(catalog)).toEqual([
      {
        key: "openai:gpt-live-1",
        label: "OpenAI API · GPT Live",
        voices: [{ key: voiceSelectionKey(marin), label: "Marin" }],
      },
    ]);
  });
});

describe("describeVoiceSelection", () => {
  it("names a usable voice with its account and model", () => {
    expect(describeVoiceSelection(marin, catalog)).toEqual({
      label: "Marin",
      detail: "OpenAI API · GPT Live",
      issue: null,
    });
  });

  it("flags a voice whose account can't be used", () => {
    expect(describeVoiceSelection(rex, catalog)).toMatchObject({
      label: "Rex",
      issue: "connection-unusable",
    });
  });

  it("flags removed accounts and voices", () => {
    expect(describeVoiceSelection({ ...marin, connectionId: "gone" }, catalog).issue).toBe(
      "connection-removed",
    );
    expect(describeVoiceSelection({ ...marin, voice: "retired" }, catalog).issue).toBe(
      "voice-removed",
    );
  });

  it("doesn't call a saved voice broken before the catalog loads", () => {
    expect(describeVoiceSelection(marin, null).issue).toBeNull();
  });
});

describe("resolveBotVoice", () => {
  it("follows the default without an override", () => {
    expect(resolveBotVoice(settings, ProjectId.make("assistant"))).toEqual({
      kind: "default",
      selection: marin,
    });
  });

  it("treats a null override as the bot's own choice of no voice", () => {
    expect(resolveBotVoice(settings, fitness)).toEqual({ kind: "own", selection: rex });
    expect(resolveBotVoice(settings, finance)).toEqual({ kind: "own", selection: null });
  });
});

describe("botVoiceOverridePatch", () => {
  it("keeps the bot's other overrides when setting its voice", () => {
    expect(botVoiceOverridePatch(settings, fitness, marin)).toEqual({
      projectSettingsOverrides: {
        [fitness]: { voiceSelection: marin, responseStreamingMode: "turn" },
      },
    });
  });

  it("removes only the voice override on reset", () => {
    expect(botVoiceOverridePatch(settings, fitness, undefined)).toEqual({
      projectSettingsOverrides: { [fitness]: { responseStreamingMode: "turn" } },
    });
    expect(botVoiceOverridePatch(settings, finance, undefined)).toEqual({
      projectSettingsOverrides: { [finance]: null },
    });
  });
});

describe("voiceConnectionUsers", () => {
  it("lists the default and the bots whose own voice uses the account", () => {
    const bots = [
      { id: fitness, title: "Fitness" },
      { id: finance, title: "Finance" },
      { id: ProjectId.make("assistant"), title: "Assistant" },
    ];
    expect(voiceConnectionUsers(settings, "xai", bots)).toEqual({
      usedByDefault: false,
      botTitles: ["Fitness"],
    });
    expect(voiceConnectionUsers(settings, "openai", bots)).toEqual({
      usedByDefault: true,
      botTitles: [],
    });
  });
});
