import { ProviderDriverKind, ProviderInstanceId, type ServerSettings } from "@t3tools/contracts";

/** The registry synthesizes the default Codex instance even before settings are saved. */
export function voiceProviderInstances(
  settings: Pick<ServerSettings, "providerInstances">,
): ServerSettings["providerInstances"] {
  return {
    [ProviderInstanceId.make("codex")]: {
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex 1",
      config: {},
    },
    ...settings.providerInstances,
  };
}
