import Constants from "expo-constants";
import { Platform } from "react-native";
import { supportsAndroidAgentNotifications } from "./androidNotifications";

export function supportsAgentAwarenessPush() {
  return Platform.OS === "android"
    ? supportsAndroidAgentNotifications()
    : Platform.OS === "ios" &&
        (Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true ||
          Constants.expoConfig?.extra?.iosPersonalTeamPushNotifications === true);
}

export function supportsAgentAwarenessLiveActivities() {
  return (
    supportsAgentAwarenessPush() &&
    (Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true ||
      Constants.expoConfig?.extra?.iosPersonalTeamLiveActivities === true)
  );
}
