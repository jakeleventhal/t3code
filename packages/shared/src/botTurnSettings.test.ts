import { DEFAULT_SERVER_SETTINGS, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveBotTurnSettings } from "./projectSettings.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const projectId = ProjectId.make("fitness");
const fallback = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "old-model" },
  runtimeMode: "full-access" as const,
};
const chosen = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "chosen-model",
  options: [{ id: "effort", value: "high" }],
};

describe("bot turn settings", () => {
  it("preserves existing configuration until a bot default is chosen", () => {
    expect(resolveBotTurnSettings(DEFAULT_SERVER_SETTINGS, projectId, fallback)).toEqual(fallback);
  });
  it("takes changed defaults on the next resolution without mutating running configuration", () => {
    const running = resolveBotTurnSettings(DEFAULT_SERVER_SETTINGS, projectId, fallback);
    const updated = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      botDefaults: { defaultModelSelection: chosen, defaultRuntimeMode: "approval-required" },
    });
    expect(resolveBotTurnSettings(updated, projectId, fallback)).toEqual({
      modelSelection: chosen,
      runtimeMode: "approval-required",
    });
    expect(running).toEqual(fallback);
    expect(updated.defaultModelSelection).toEqual(DEFAULT_SERVER_SETTINGS.defaultModelSelection);
  });
  it("keeps per-bot overrides while other bots follow the defaults", () => {
    const updated = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      botDefaults: { defaultModelSelection: chosen, defaultRuntimeMode: "approval-required" },
      projectSettingsOverrides: {
        [projectId]: {
          defaultModelSelection: fallback.modelSelection,
          defaultRuntimeMode: "full-access",
        },
      },
    });
    expect(resolveBotTurnSettings(updated, projectId, fallback)).toEqual(fallback);
    expect(
      resolveBotTurnSettings(updated, ProjectId.make("another"), fallback).modelSelection,
    ).toEqual(chosen);
  });
  it("does not silently substitute a different model if its provider is unavailable", () => {
    const updated = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      botDefaults: { defaultModelSelection: chosen, defaultRuntimeMode: null },
    });
    expect(resolveBotTurnSettings(updated, projectId, fallback).modelSelection).toEqual(chosen);
  });
  it("removing a per-bot override resumes inheritance", () => {
    const customized = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      botDefaults: { defaultModelSelection: chosen, defaultRuntimeMode: null },
      projectSettingsOverrides: { [projectId]: { defaultModelSelection: fallback.modelSelection } },
    });
    const reset = applyServerSettingsPatch(customized, {
      projectSettingsOverrides: { [projectId]: null },
    });
    expect(resolveBotTurnSettings(reset, projectId, fallback).modelSelection).toEqual(chosen);
  });
});
