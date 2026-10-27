import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { BotHeaderTitle, useBotHeaderTopInset, type BotChatIdentity } from "./BotHeaderTitle";

export function BotChatHeader(props: {
  readonly identity: BotChatIdentity;
  readonly onCall?: () => void;
  readonly onOpenThreads?: () => void;
}) {
  const topInset = useBotHeaderTopInset();
  const { width } = useWindowDimensions();
  const goBack = useWorkspaceBackNavigation("threads");
  const { layout, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const nativeHeader = Platform.OS === "ios" && !layout.usesSplitView;
  const actions = [
    ...(props.onCall ? [{ id: "call", title: "Call", image: "phone", onPress: props.onCall }] : []),
    ...(props.onOpenThreads
      ? [
          {
            id: "conversations",
            title: "Conversations",
            image: "bubble.left.and.bubble.right",
            onPress: props.onOpenThreads,
          },
        ]
      : []),
    {
      id: "profile",
      title: "Profile",
      image: "person.crop.circle",
      onPress: props.identity.onPress,
    },
  ];
  return (
    <>
      <NativeStackScreenOptions
        options={{
          // A visible native back item keeps UIKit's interactive pop transition available.
          headerShown: nativeHeader,
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: "",
          headerBackVisible: true,
          gestureEnabled: true,
          unstable_headerLeftItems: () => [],
          unstable_headerRightItems: () =>
            nativeHeader
              ? [
                  {
                    type: "menu",
                    label: "Bot actions",
                    icon: { type: "sfSymbol", name: "ellipsis" },
                    menu: {
                      items: actions.map((action) => ({
                        type: "action",
                        label: action.title,
                        icon: { type: "sfSymbol", name: action.image },
                        onPress: action.onPress,
                      })),
                    },
                  },
                ]
              : [],
          unstable_headerToolbarItems: () => [],
        }}
      />
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: topInset + 6, left: 16, right: 16, zIndex: 10 }}
      >
        <View pointerEvents="box-none" className="flex-row items-start justify-between">
          {nativeHeader ? (
            <View className="size-11" />
          ) : (
            <GlassSurface style={{ borderRadius: 22 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={layout.usesSplitView ? "Toggle sidebar" : "Back"}
                onPress={layout.usesSplitView ? togglePrimarySidebar : goBack}
                className="size-11 items-center justify-center active:opacity-70"
              >
                <SymbolView
                  name={layout.usesSplitView ? "sidebar.left" : "chevron.left"}
                  size={22}
                  tintColorClassName="accent-foreground"
                />
              </Pressable>
            </GlassSurface>
          )}
          <View pointerEvents="box-none" className="min-w-0 flex-1 items-center px-3">
            <BotHeaderTitle {...props.identity} maxWidth={Math.max(68, width - 152)} />
          </View>
          {nativeHeader ? (
            <View className="size-11" />
          ) : (
            <Menu
              actions={actions}
              onPressAction={({ nativeEvent }) => {
                actions.find((action) => action.id === nativeEvent.event)?.onPress();
              }}
            >
              <GlassSurface style={{ borderRadius: 22 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bot actions"
                  className="size-11 items-center justify-center active:opacity-70"
                >
                  <SymbolView name="ellipsis" size={22} tintColorClassName="accent-foreground" />
                </Pressable>
              </GlassSurface>
            </Menu>
          )}
        </View>
      </View>
    </>
  );
}
