import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, Pressable, StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import {
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { useAdaptiveWorkspaceLayout } from "./adaptive-workspace-context";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { WorkspaceSlotOptionsContext } from "../../native/v5-workspace-context";

const DrawerContentWidthContext = createContext<((width: number) => void) | null>(null);

/** The content width excludes whatever rail UIKit reserved in this detached controller. */
export function WorkspaceSidebarDrawerContent(props: { readonly children: ReactNode }) {
  const reportWidth = use(DrawerContentWidthContext);
  const contentWidth = useNativeColumnLayoutMetrics()?.width;
  const report = useEffectEvent((width: number) => reportWidth?.(width));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the detached controller instead of assuming it reserves the window's rail inset
  useEffect(() => {
    if (contentWidth !== undefined && contentWidth > 0) report(contentWidth);
  }, [contentWidth]);
  return props.children;
}

export function WorkspaceSidebarDrawer(props: {
  readonly visible: boolean;
  readonly width: number;
  readonly onDismiss: VoidFunction;
  readonly children: ReactNode;
}) {
  const { width } = props;
  const metrics = useNativeLayoutMetrics();
  const [navigationInset, setNavigationInset] = useState(metrics?.safeArea.right ?? 0);
  const navigationWidth = width + navigationInset;
  const reportContentWidth = (contentWidth: number) =>
    setNavigationInset(Math.max(0, navigationWidth - contentWidth));
  const { setPrimarySidebarSearchQuery } = useAdaptiveWorkspaceLayout();
  const workspace = useWorkspaceTabs();
  const setSearchQuery = (query: string) => {
    if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setPrimarySidebarSearchQuery(query);
  };
  const [optionsByRoute, setOptionsByRoute] = useState<ReadonlyMap<string, object>>(new Map());
  const setRouteOptions = (key: string, options: object) =>
    setOptionsByRoute((current) =>
      new Map(current).set(key, {
        ...current.get(key),
        ...options,
        unstable_navigationItemStyle: "navigator",
        unstable_headerToolbarItems: () => [],
        headerSearchBarOptions: {
          placeholder: "Search threads",
          allowToolbarIntegration: false,
          hideNavigationBar: false,
          hideWhenScrolling: false,
          obscureBackground: false,
          onChangeText: (event: NativeSyntheticEvent<{ text: string }>) =>
            setSearchQuery(event.nativeEvent.text),
        },
      }),
    );
  const slotOptions = { byRoute: optionsByRoute, set: setRouteOptions };
  const [mounted, setMounted] = useState(props.visible);
  if (props.visible && !mounted) setMounted(true);
  const wasVisible = useRef(props.visible);
  const progress = useSharedValue(props.visible ? 1 : 0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- slides the retained sidebar over the workspace without changing either native content column
  useEffect(() => {
    progress.set(withTiming(props.visible ? 1 : 0, { duration: 220 }));
    if (!props.visible && wasVisible.current) Keyboard.dismiss();
    wasVisible.current = props.visible;
  }, [progress, props.visible]);
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * width }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.2 }));
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}
      pointerEvents={props.visible ? "auto" : "none"}
      accessibilityElementsHidden={!props.visible}
      importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "black" }, scrimStyle]}
        pointerEvents="none"
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="Dismiss thread drawer"
        onPress={props.onDismiss}
      />
      <Animated.View
        style={[
          {
            width: props.width,
            height: "100%",
            overflow: "hidden",
            borderTopRightRadius: 24,
            borderBottomRightRadius: 24,
          },
          drawerStyle,
        ]}
      >
        <View style={{ width: navigationWidth, flex: 1 }}>
          {mounted ? (
            <DrawerContentWidthContext value={reportContentWidth}>
              <WorkspaceSlotOptionsContext value={slotOptions}>
                {props.children}
              </WorkspaceSlotOptionsContext>
            </DrawerContentWidthContext>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
