import Constants from "expo-constants";
import { Platform } from "react-native";
import { supportsAndroidAgentNotifications } from "./androidNotifications";

export function supportsAgentAwarenessPush() {
  const extra = Constants.expoConfig?.extra;
  return Platform.OS === "android"
    ? supportsAndroidAgentNotifications()
    : Platform.OS === "ios" &&
        (extra?.iosPersonalTeamBuild !== true || extra.iosPersonalTeamPushNotifications === true);
}

export const supportsAgentAwarenessNotifications = supportsAgentAwarenessPush;

export function supportsAgentAwarenessLiveActivities() {
  const extra = Constants.expoConfig?.extra;
  return (
    supportsAgentAwarenessPush() &&
    (extra?.iosPersonalTeamBuild !== true || extra.iosPersonalTeamLiveActivities === true)
  );
}
