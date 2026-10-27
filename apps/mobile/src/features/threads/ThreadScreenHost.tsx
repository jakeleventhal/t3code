import { HeaderHeightContext } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BOT_CHAT_HEADER_HEIGHT } from "../bots/BotHeaderTitle";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { ThreadDetailScreen, type ThreadDetailScreenProps } from "./ThreadDetailScreen";

type ThreadScreenContent =
  | { readonly props: ThreadDetailScreenProps }
  | { readonly fallback: ReactNode };

function createThreadScreenStore() {
  let current: ThreadScreenContent | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (content: ThreadScreenContent) => {
      current = content;
      for (const listener of listeners) listener();
    },
  };
}
const ThreadScreenContext = createContext<ReturnType<typeof createThreadScreenStore> | null>(null);

function ThreadScreenOutlet() {
  const store = useContext(ThreadScreenContext)!;
  const content = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const nativeHeaderHeight = useContext(HeaderHeightContext);
  const insets = useSafeAreaInsets();
  if (content === null) return null;
  return "props" in content ? (
    <HeaderHeightContext
      value={
        content.props.floatingBotHeader ? insets.top + BOT_CHAT_HEADER_HEIGHT : nativeHeaderHeight
      }
    >
      {!content.props.floatingBotHeader ? content.props.header : null}
      <ThreadDetailScreen {...content.props} />
      {content.props.floatingBotHeader ? content.props.header : null}
    </HeaderHeightContext>
  ) : (
    content.fallback
  );
}

// Controllers can change from draft to live without replacing the native screen,
// the keyboard host, or the editor. Publish before paint to avoid an intermediate frame.
export function ThreadScreenHost({ children }: { readonly children: ReactNode }) {
  const [store] = useState(createThreadScreenStore);
  return (
    <ThreadScreenContext.Provider value={store}>
      {children}
      <View className="flex-1 bg-screen android:overflow-hidden android:rounded-t-[28px] android:bg-thread-canvas">
        <ThreadScreenOutlet />
      </View>
    </ThreadScreenContext.Provider>
  );
}

export function ThreadScreenBinding(props: ThreadDetailScreenProps) {
  const store = useContext(ThreadScreenContext)!;
  useLayoutEffect(() => {
    store.publish({ props });
  });
  return null;
}

export function ThreadScreenFallback({ children }: { readonly children: ReactNode }) {
  const store = useContext(ThreadScreenContext)!;
  useLayoutEffect(() => {
    store.publish({ fallback: children });
  });
  return null;
}
