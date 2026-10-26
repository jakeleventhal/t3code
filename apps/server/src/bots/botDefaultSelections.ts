import type { BotPreferencesChange, ServerProvider, ServerSettings } from "@t3tools/contracts";

export function initialBotDefaults(
  settings: ServerSettings,
  providers: readonly ServerProvider[],
): BotPreferencesChange {
  const available = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status !== "disabled" &&
      provider.availability !== "unavailable" &&
      provider.auth.status === "authenticated",
  );
  const select = (complex: boolean) => {
    for (const [driver, model, effort] of complex
      ? [
          ["claudeAgent", "claude-opus-5-5", "high"],
          ["codex", "gpt-6-astra", "medium"],
        ]
      : [
          ["claudeAgent", "claude-haiku-5-5", "medium"],
          ["codex", "gpt-6.1-sol", "low"],
        ]) {
      const provider = available.find(
        (entry) => entry.driver === driver && entry.models.some((entry) => entry.slug === model),
      );
      if (provider && model && effort)
        return {
          instanceId: provider.instanceId,
          model,
          options: [{ id: driver === "codex" ? "reasoningEffort" : "effort", value: effort }],
        };
    }
    return undefined;
  };
  const subscription = Object.entries(settings.voiceConnections).find(
    ([, connection]) =>
      connection.kind === "codex-subscription" &&
      available.some((provider) => provider.instanceId === connection.providerInstanceId),
  );
  return {
    defaultModelSelection: select(false),
    complexTaskModelSelection: select(true),
    defaultRuntimeMode: settings.defaultRuntimeMode,
    ...(subscription
      ? {
          defaultVoiceSelection: {
            connectionId: subscription[0],
            model: "gpt-live-subscription",
            voice: "sol",
          },
        }
      : {}),
  };
}
