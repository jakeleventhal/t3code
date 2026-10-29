import { useState, type ComponentProps, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { Screen, ScreenStack, ScreenStackHeaderConfig } from "react-native-screens";

import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { NativeInspectorContent } from "../../native/NativeInspectorContent";
import { nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "./adaptive-workspace-context";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

/** An iOS workspace navigator in the inspector column: native title, close button, optional search. */
export function NativeWorkspaceNavigatorPane(props: {
  readonly screenId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly closeLabel: string;
  /** A `ScreenStackHeaderSearchBarView` for the header. */
  readonly searchBar?: ReactNode;
  /**
   * Pads the content below the translucent header, for panes that do not scroll as a whole and
   * so get no automatic inset. An opaque header is not enough: on the iPhone Duo it lays content
   * out below the bar's height but not the status bar inset above it.
   */
  readonly insetBelowHeader?: boolean;
  readonly children: ReactNode;
}) {
  const { toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  const theme = useUniwindTheme();
  const foregroundColor = theme["--color-foreground"];
  const sheetColor = theme["--color-sheet"];
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRightBarButtonItems = [
    {
      accessibilityLabel: props.closeLabel,
      icon: { name: "xmark", type: "sfSymbol" as const },
      identifier: `${props.screenId}-close`,
      onPress: toggleAuxiliaryPane,
      sharesBackground: false,
      tintColor: foregroundColor,
      type: "button" as const,
    },
  ] as ComponentProps<typeof ScreenStackHeaderConfig>["headerRightBarButtonItems"];

  return (
    <View className="flex-1 border-l border-border bg-sheet">
      <ScreenStack style={{ flex: 1 }}>
        <Screen
          activityState={2}
          enabled
          isNativeStack
          screenId={props.screenId}
          scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
          style={{ backgroundColor: sheetColor, flex: 1 }}
          onHeaderHeightChange={
            props.insetBelowHeader
              ? (event) => setHeaderHeight(event.nativeEvent.headerHeight)
              : undefined
          }
        >
          <NativeInspectorContent>
            {props.insetBelowHeader ? (
              <View style={{ flex: 1, paddingTop: headerHeight }}>{props.children}</View>
            ) : (
              props.children
            )}
          </NativeInspectorContent>
          <ScreenStackHeaderConfig
            backgroundColor="rgba(0,0,0,0)"
            color={foregroundColor}
            headerRightBarButtonItems={headerRightBarButtonItems}
            hideBackButton
            hideShadow={false}
            navigationItemStyle="editor"
            subtitle={props.subtitle}
            title={props.title}
            titleColor={foregroundColor}
            titleFontSize={17}
            titleFontWeight="700"
            translucent
          >
            {props.searchBar}
          </ScreenStackHeaderConfig>
        </Screen>
      </ScreenStack>
    </View>
  );
}
