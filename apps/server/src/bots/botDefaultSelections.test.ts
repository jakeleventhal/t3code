import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { initialBotDefaults } from "./botDefaultSelections.ts";

function connectedBotProvider(driver: string, models: string[]): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-26T12:00:00Z",
    models: models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
    slashCommands: [],
    skills: [],
  };
}
const claude = connectedBotProvider("claudeAgent", ["claude-haiku-5-5", "claude-opus-5-5"]);
const codex = connectedBotProvider("codex", ["gpt-6.1-sol", "gpt-6-astra"]);

it("prefers Claude with separate chat and complex reasoning and falls back to authenticated Codex", () => {
  expect(initialBotDefaults(DEFAULT_SERVER_SETTINGS, [codex, claude])).toMatchObject({
    defaultModelSelection: {
      instanceId: "claudeAgent",
      model: "claude-haiku-5-5",
      options: [{ id: "effort", value: "medium" }],
    },
    complexTaskModelSelection: {
      instanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: [{ id: "effort", value: "high" }],
    },
  });
  expect(
    initialBotDefaults(DEFAULT_SERVER_SETTINGS, [
      codex,
      { ...claude, auth: { status: "unauthenticated" } },
    ]),
  ).toMatchObject({
    defaultModelSelection: {
      instanceId: "codex",
      model: "gpt-6.1-sol",
      options: [{ id: "reasoningEffort", value: "low" }],
    },
    complexTaskModelSelection: {
      instanceId: "codex",
      model: "gpt-6-astra",
      options: [{ id: "reasoningEffort", value: "medium" }],
    },
  });
  expect(
    initialBotDefaults(DEFAULT_SERVER_SETTINGS, [{ ...claude, installed: false }])
      .defaultModelSelection,
  ).toBeUndefined();
});
