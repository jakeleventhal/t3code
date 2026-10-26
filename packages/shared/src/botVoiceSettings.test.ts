import { botVoiceSelection } from "./botPreferences.ts";
import {
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  requiredScopesForServerSettingsPatch,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { resolveProjectSettings } from "./projectSettings.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const bot = ProjectId.make("fitness");
const selection = { connectionId: "personal", model: "gpt-live-1", voice: "marin" };
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const decodePatch = Schema.decodeUnknownOption(ServerSettingsPatch);

describe("voice settings", () => {
  it("decodes older settings without enabling voice", () => {
    const settings = decodeSettings({});
    expect(settings.voiceSelection).toBeNull();
    expect(settings.voiceConnections).toEqual({});
  });

  it("replaces an account atomically and deletes it without changing another account", () => {
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      voiceConnections: {
        personal: { kind: "openai-api", name: "Personal", apiKey: "test-key" },
        work: { kind: "xai-api", name: "Work", apiKey: "other-key" },
      },
      voiceSelection: selection,
    });
    const replaced = applyServerSettingsPatch(initial, {
      voiceConnections: {
        personal: {
          kind: "codex-subscription",
          name: "Plan",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
      },
    });
    expect(replaced.voiceConnections.personal).not.toHaveProperty("apiKey");
    const deleted = applyServerSettingsPatch(replaced, { voiceConnections: { personal: null } });
    expect(Object.keys(deleted.voiceConnections)).toEqual(["work"]);
    // A removed credential must not silently move a call to another billed account.
    expect(deleted.voiceSelection).toEqual(selection);
  });

  it("inherits voice, overrides it per bot, and resets without changing the work model", () => {
    const base = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { voiceSelection: selection });
    expect(resolveProjectSettings(base, bot).settings.voiceSelection).toEqual(selection);
    const changed = applyServerSettingsPatch(base, {
      projectSettingsOverrides: { [bot]: { voiceSelection: { ...selection, voice: "quartz" } } },
    });
    expect(resolveProjectSettings(changed, bot).settings.voiceSelection?.voice).toBe("quartz");
    expect(resolveProjectSettings(changed, bot).settings.defaultModelSelection).toEqual(
      base.defaultModelSelection,
    );
    expect(changed.voiceSelection).toEqual(selection);
    const reset = applyServerSettingsPatch(changed, { projectSettingsOverrides: { [bot]: {} } });
    expect(resolveProjectSettings(reset, bot).settings.voiceSelection).toEqual(selection);
  });

  it("keeps an explicit unconfigured bot distinct from inheritance", () => {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      voiceSelection: selection,
      projectSettingsOverrides: { [bot]: { voiceSelection: null } },
    });
    const resolved = resolveProjectSettings(settings, bot);
    expect(resolved.settings.voiceSelection).toBeNull();
    expect(resolved.sources.voiceSelection).toBe("project");
    expect(
      resolveProjectSettings(settings, ProjectId.make("assistant")).settings.voiceSelection,
    ).toEqual(selection);
  });

  it("requires provider management for credentials and settings write for selections", () => {
    expect(requiredScopesForServerSettingsPatch({ voiceConnections: { personal: null } })).toEqual([
      AuthProvidersManageScope,
    ]);
    expect(requiredScopesForServerSettingsPatch({ voiceSelection: selection })).toEqual([
      AuthSettingsWriteScope,
    ]);
    expect(
      requiredScopesForServerSettingsPatch({
        projectSettingsOverrides: { [bot]: { voiceSelection: null } },
      }),
    ).toEqual([AuthSettingsWriteScope]);
    expect(
      requiredScopesForServerSettingsPatch({ voiceConnections: {}, voiceSelection: selection }),
    ).toEqual([AuthSettingsWriteScope, AuthProvidersManageScope]);
  });

  it("rejects incomplete voice selections instead of retaining fields from another account", () => {
    expect(decodePatch({ voiceSelection: { connectionId: "work" } })._tag).toBe("None");
  });
});

it("uses the shared default when unified overrides are empty despite a stale local voice", () => {
  const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    voiceConnections: { personal: { kind: "openai-api", name: "Personal", apiKey: "test" } },
    projectSettingsOverrides: { [bot]: { voiceSelection: { ...selection, voice: "arbor" } } },
    botSharedPreferences: {
      ...DEFAULT_SERVER_SETTINGS.botSharedPreferences,
      defaultVoice: { ...selection, voice: "sol", connectionKind: "openai-api" },
      voiceOverrides: {},
    },
  });
  expect(botVoiceSelection(settings, bot)).toEqual({
    kind: "default",
    selection: { ...selection, voice: "sol" },
  });
});
