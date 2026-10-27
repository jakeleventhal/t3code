import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { BotHeaderTitle, type BotChatIdentity } from "./BotHeaderTitle";

export function BotChatHeader(props: {
  readonly identity: BotChatIdentity;
  readonly onCall?: () => void;
  readonly onOpenThreads?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const goBack = useWorkspaceBackNavigation("threads");
  const { layout, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  return (
    <>
      <NativeStackScreenOptions
        options={{
          headerShown: false,
          gestureEnabled: Platform.OS !== "ios" || layout.usesSplitView,
          unstable_headerToolbarItems: () => [],
        }}
      />
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: insets.top + 6, left: 16, right: 16, zIndex: 10 }}
      >
        <View pointerEvents="box-none" className="flex-row items-start justify-between">
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
          <View pointerEvents="box-none" className="min-w-0 flex-1 items-center px-3">
            <BotHeaderTitle {...props.identity} maxWidth={Math.max(68, width - 152)} />
          </View>
          <Menu
            actions={[
              ...(props.onCall ? [{ id: "call", title: "Call", image: "phone" }] : []),
              ...(props.onOpenThreads
                ? [
                    {
                      id: "conversations",
                      title: "Conversations",
                      image: "bubble.left.and.bubble.right",
                    },
                  ]
                : []),
              { id: "profile", title: "Profile", image: "person.crop.circle" },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "call") props.onCall?.();
              else if (nativeEvent.event === "conversations") props.onOpenThreads?.();
              else if (nativeEvent.event === "profile") props.identity.onPress();
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
        </View>
      </View>
    </>
  );
}
