import {
  EnvironmentId,
  ThreadId,
  GuestShareId,
  GuestMessageId,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const { Slot, sharing } = vi.hoisted(() => ({
  Slot: ({ children }: { children?: ReactNode }) => children,
  sharing: {
    share: null as ThreadGuestShare | null,
    updatedAt: "1970-01-01T00:00:00.000Z",
    create:
      vi.fn<() => Promise<{ _tag: "Success"; value: { url: string; share: ThreadGuestShare } }>>(),
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ScrollView: Slot,
  View: Slot,
  Share: {},
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: () => {} }),
  usePreventRemove: () => {},
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: { value: unknown }, select?: (value: unknown) => unknown) =>
    select ? select(atom.value) : atom.value,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { createGuestShare: { permissionAtom: () => ({ value: true }) } },
  environmentServerConfigsAtom: {},
}));
vi.mock("../../state/threads", () => ({
  environmentThreadDetails: {
    threadAtom: () => ({
      get value() {
        return { projection: { thread: { updatedAt: DateTime.makeUnsafe(sharing.updatedAt) } } };
      },
    }),
    statusAtom: () => ({ value: "ready" }),
    errorAtom: () => ({ value: null }),
  },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => sharing.create }));
vi.mock("./ThreadGuestShareBar", () => ({ useThreadGuestShare: () => sharing.share }));
vi.mock("../../components/ui/AppText", () => ({ AppText: Slot }));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress?: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppBar", () => ({ AppBar: () => null }));
vi.mock("../../components/ui/SheetHeader", () => ({ SheetHeader: () => null }));
vi.mock("../../components/ui/ScreenContent", () => ({ ScreenContent: Slot }));
vi.mock("../../components/ui/Dialog", () => ({}));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
vi.mock("../../lib/copyTextWithHaptic", () => ({ tryCopyTextWithHaptic: () => true }));

import { ThreadGuestShareSheet } from "./ThreadGuestShareSheet";

function setup() {
  sharing.share = {
    id: GuestShareId.make("old"),
    host: "guest.test",
    createdAt: "1970-01-01T00:00:00.000Z",
    expiresAt: "1970-01-01T00:00:01.000Z",
    guestName: null,
    messages: [],
  };
  sharing.updatedAt = "1970-01-01T00:00:00.000Z";
  sharing.create.mockReset();
}

it("stops treating a retained guest link as active when it expires", async () => {
  setup();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const renderSheet = () =>
    root.render(
      <ThreadGuestShareSheet
        route={{
          params: {
            environmentId: EnvironmentId.make("test"),
            threadId: ThreadId.make("thread"),
          },
        }}
      />,
    );
  try {
    await act(renderSheet);
    expect(container.textContent).toContain("A guest link is active.");
    expect(container.querySelector("button")?.textContent).toBe("Create new link");

    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(container.textContent).not.toContain("A guest link is active.");
    expect(container.querySelector("button")?.textContent).toBe("Create link");
    sharing.share = {
      ...sharing.share!,
      messages: [
        {
          id: GuestMessageId.make("message"),
          text: "Hello",
          status: "pending",
          submittedAt: "1970-01-01T00:00:00.000Z",
        },
      ],
    };
    await act(renderSheet);
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.textContent).toContain("Send or dismiss pending guest messages");

    sharing.share = { ...sharing.share!, messages: [] };
    await act(renderSheet);
    expect(container.querySelector("button")?.disabled).toBe(false);

    const created = {
      ...sharing.share!,
      id: GuestShareId.make("new"),
      createdAt: "1970-01-01T00:00:01.000Z",
      expiresAt: "1970-01-01T00:00:02.000Z",
    };
    sharing.create.mockResolvedValue({
      _tag: "Success",
      value: { url: "https://guest.test/new", share: created },
    });
    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("https://guest.test/new");
    sharing.updatedAt = created.createdAt;
    sharing.share = created;
    await act(renderSheet);
    expect(container.textContent).toContain("https://guest.test/new");
    sharing.share = { ...created, guestName: "Sam" };
    await act(renderSheet);
    expect(container.textContent).not.toContain("https://guest.test/new");
    sharing.share = null;
    await act(renderSheet);
    expect(container.textContent).not.toContain("https://guest.test/new");
    sharing.share = { ...created, id: GuestShareId.make("replacement") };
    await act(renderSheet);
    expect(container.textContent).not.toContain("https://guest.test/new");
    sharing.share = created;
    await act(renderSheet);
    expect(container.textContent).toContain("https://guest.test/new");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).not.toContain("https://guest.test/new");
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
