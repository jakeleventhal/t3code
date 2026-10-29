import { useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import {
  Screen,
  ScreenStack,
  ScreenStackHeaderConfig,
  ScreenStackHeaderLeftView,
  ScreenStackHeaderRightView,
} from "react-native-screens";

import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { NativeInspectorContent } from "../../native/NativeInspectorContent";
import { nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

/** An iOS workspace navigator in the inspector column: native title and optional search. */
export function NativeWorkspaceNavigatorPane(props: {
  readonly screenId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly header?: ReactNode;
  readonly trailing?: ReactNode;
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
  const theme = useUniwindTheme();
  const foregroundColor = theme["--color-foreground"];
  const sheetColor = theme["--color-sheet"];
  const [headerHeight, setHeaderHeight] = useState(0);

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
            color={foregroundColor}
            hideBackButton
            hideShadow={false}
            navigationItemStyle="editor"
            subtitle={props.header ? undefined : props.subtitle}
            title={props.header ? "" : props.title}
            titleColor={foregroundColor}
            titleFontSize={17}
            titleFontWeight="700"
            translucent
          >
            {props.header ? (
              <ScreenStackHeaderLeftView
                hidesSharedBackground
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                {props.header}
              </ScreenStackHeaderLeftView>
            ) : null}
            {props.trailing ? (
              <ScreenStackHeaderRightView>{props.trailing}</ScreenStackHeaderRightView>
            ) : null}
            {props.searchBar}
          </ScreenStackHeaderConfig>
        </Screen>
      </ScreenStack>
    </View>
  );
}
