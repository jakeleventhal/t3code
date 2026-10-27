import { describe, expect, it } from "@effect/vitest";
import {
  EMPTY_BOT_SHARED_PREFERENCES,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";

import { botRoutedModels, explicitBotTaskModels } from "./botPreferences.ts";

const selection = (model: string, effort?: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude"),
  model,
  ...(effort ? { options: [{ id: "effort", value: effort }] } : {}),
});

const agent = (model: string, status = "running", effort?: string) =>
  ({ model, modelSelection: selection(model, effort), status }) as OrchestrationV2Subagent;

describe("explicitBotTaskModels", () => {
  const fitness = ProjectId.make("fitness");
  const routed = botRoutedModels(
    {
      ...EMPTY_BOT_SHARED_PREFERENCES,
      defaultModelSelection: selection("claude-haiku-5-5"),
      complexTaskModelSelection: selection("claude-opus-5-5"),
      complexTaskModelOverrides: { [fitness]: selection("claude-sonnet-5-5") },
      automaticModelSelections: { complex: selection("gpt-6-astra") },
    },
    fitness,
  );

  it("keeps quiet escalation and automatic fallbacks unlabeled", () => {
    expect(
      explicitBotTaskModels(
        [agent("claude-sonnet-5-5"), agent("gpt-6-astra"), agent("claude-haiku-5-5")],
        routed,
      ),
    ).toEqual([]);
  });

  it("names a running model the bot was asked to use", () => {
    expect(
      explicitBotTaskModels(
        [agent("claude-opus-5-5", "running", "high"), agent("grok-4.7-fast", "completed")],
        botRoutedModels(EMPTY_BOT_SHARED_PREFERENCES, fitness),
      ),
    ).toEqual(["Claude Opus 5.5 · High"]);
    expect(explicitBotTaskModels([agent("grok-4.7-fast", "waiting")], routed)).toHaveLength(1);
  });
});
