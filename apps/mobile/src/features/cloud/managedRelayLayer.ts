import { DpopProof, ManagedRelay } from "@t3tools/client-runtime/relay";
import Constants from "expo-constants";
import { RelayMobileClientId } from "@t3tools/contracts/relay";
import * as Layer from "effect/Layer";

import { loadOrCreateProofKey } from "./dpop";
import { resolveCloudPublicConfig } from "./publicConfig";
import { managedRelayAccessTokenStore } from "./managedRelayTokenStore";

const layerRelayDpopSigner = DpopProof.layerSigner({
  keyStore: "expo-secure-store",
  loadOrCreateKey: loadOrCreateProofKey(),
});

export function personalBackgroundRelayUrl(): string | null {
  const value = Constants.expoConfig?.extra?.personalBackgroundRelayUrl;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const layer = (relayUrl: string) =>
  ManagedRelay.layer({
    relayUrl,
    backgroundRelayUrl:
      personalBackgroundRelayUrl() ?? resolveCloudPublicConfig().relay.backgroundUrl ?? undefined,
    clientId: RelayMobileClientId,
    accessTokenStore: managedRelayAccessTokenStore,
  }).pipe(Layer.provideMerge(layerRelayDpopSigner));
