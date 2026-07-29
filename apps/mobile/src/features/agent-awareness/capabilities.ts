import Constants from "expo-constants";

export function supportsAgentAwarenessNotifications() {
  const extra = Constants.expoConfig?.extra;
  return extra?.iosPersonalTeamBuild !== true || extra.iosPersonalTeamPushNotifications === true;
}

export function supportsAgentAwarenessLiveActivities() {
  const extra = Constants.expoConfig?.extra;
  return extra?.iosPersonalTeamBuild !== true || extra.iosPersonalTeamLiveActivities === true;
}
