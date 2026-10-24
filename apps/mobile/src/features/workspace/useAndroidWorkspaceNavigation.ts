import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";
import {
  resetAndroidWorkspace,
  returnToAndroidWorkspaceList,
} from "../../lib/android-workspace-navigation";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** Selects a Code list, unless the page belongs to Bots, whose back leads to the Bots list. */
function useSelectCodeTab(tab: WorkspaceTab) {
  const workspace = useWorkspaceTabs();
  const dispatch = workspace?.dispatch;
  const code = workspace?.state.room !== "bots";
  return useCallback(() => {
    if (code) dispatch?.({ type: "select", tab });
  }, [code, dispatch, tab]);
}

export function useWorkspaceListNavigation(tab: WorkspaceTab) {
  const navigation = useNavigation();
  const selectTab = useSelectCodeTab(tab);
  return useCallback(() => {
    if (Platform.OS === "android") {
      selectTab();
      resetAndroidWorkspace(navigation);
    } else if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  }, [navigation, selectTab]);
}

export function useWorkspaceBackNavigation(tab: WorkspaceTab) {
  const navigation = useNavigation();
  const selectTab = useSelectCodeTab(tab);
  const returnToList = useWorkspaceListNavigation(tab);
  return useCallback(() => {
    if (Platform.OS === "android") {
      returnToAndroidWorkspaceList(navigation, selectTab);
    } else returnToList();
  }, [navigation, selectTab, returnToList]);
}

export function useAndroidWorkspaceBack(tab: WorkspaceTab) {
  const selectTab = useSelectCodeTab(tab);
  const goBack = useWorkspaceBackNavigation(tab);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      selectTab();
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (Keyboard.isVisible()) Keyboard.dismiss();
        else goBack();
        return true;
      });
      return () => subscription.remove();
    }, [goBack, selectTab]),
  );
  return goBack;
}
