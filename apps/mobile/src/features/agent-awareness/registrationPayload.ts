import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";

import type { Preferences } from "../../persistence/mobile-preferences";
import {
  supportsAgentAwarenessLiveActivities,
  supportsAgentAwarenessNotifications,
} from "./capabilities";

// Development builds are Xcode-signed and receive sandbox APNs tokens;
// preview and production builds are distribution-signed and use production
// APNs. The relay routes each device's pushes accordingly.
export function resolveApsEnvironment(
  appVariant: unknown,
  iosPersonalTeamBuild = false,
): "sandbox" | "production" {
  return appVariant === "development" || iosPersonalTeamBuild ? "sandbox" : "production";
}

export function makeRelayDeviceRegistrationRequest(input: {
  readonly deviceId: string;
  readonly label: string;
  readonly iosMajorVersion: number;
  readonly appVersion?: string;
  readonly bundleId?: string;
  readonly apsEnvironment?: "sandbox" | "production";
  readonly pushToken?: string;
  readonly pushToStartToken?: string;
  readonly notificationsEnabled: boolean;
  readonly preferences: Preferences;
}): RelayDeviceRegistrationRequest {
  const notificationsAvailable = supportsAgentAwarenessNotifications();
  const liveActivitiesAvailable = supportsAgentAwarenessLiveActivities();
  const liveActivitiesEnabled =
    liveActivitiesAvailable && input.preferences.liveActivitiesEnabled !== false;
  return {
    deviceId: input.deviceId,
    label: input.label,
    platform: "ios",
    iosMajorVersion: input.iosMajorVersion,
    appVersion: input.appVersion,
    ...(input.bundleId ? { bundleId: input.bundleId } : {}),
    ...(input.apsEnvironment ? { apsEnvironment: input.apsEnvironment } : {}),
    ...(notificationsAvailable && input.pushToken ? { pushToken: input.pushToken } : {}),
    ...(liveActivitiesAvailable && input.pushToStartToken
      ? { pushToStartToken: input.pushToStartToken }
      : {}),
    preferences: {
      liveActivitiesEnabled,
      notificationsEnabled: notificationsAvailable && input.notificationsEnabled,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
  };
}
