import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import type { ThreadRouteTarget } from "../../threadRoutes";
import type { AppRoom } from "./botRoom.logic";

export type BotProfileTab = "routines" | "files" | "settings";

export interface BotLocation {
  readonly href: string;
  readonly target: ThreadRouteTarget;
}

/** Code's quick Assistant panel, per environment: each has its own private conversation. */
export interface AssistantQuickState {
  /** Survives closing the panel, like a composer draft. */
  readonly draft: string;
  readonly sending: boolean;
  readonly error: string | null;
}

export const EMPTY_ASSISTANT_QUICK_STATE: AssistantQuickState = {
  draft: "",
  sending: false,
  error: null,
};

/**
 * Where each room was last left, so the Code | Bots switch returns to the exact review, thread,
 * or panel the user left. Session-only: a reload starts from the URL.
 */
interface BotRoomState {
  readonly room: AppRoom;
  /** The environment of the last bot conversation open in Bots, whose spot entering returns to. */
  readonly environmentId: EnvironmentId | null;
  readonly codeHref: string | null;
  readonly botLocationByEnvironment: Readonly<Record<string, BotLocation>>;
  /** The bot thread opened from Code's Assistant panel, which offers a way straight back. */
  readonly returnToCodeThreadKey: string | null;
  readonly assistantPanelOpen: boolean;
  readonly assistantQuickByEnvironment: Readonly<Record<string, AssistantQuickState>>;
  /** The open chat's slot above its composer; the floating Assistant sits there when present. */
  readonly assistantOrbSlot: HTMLElement | null;
  /** The open server thread's inline slot above its composer, where its own call sits. */
  readonly callBarSlot: { readonly element: HTMLElement; readonly threadKey: string } | null;
  /** The call whose transcript drawer is open, so a new call always starts with it closed. */
  readonly callTranscriptOpenFor: string | null;
  /** The bot profile beside the chat stays open across that bot's conversations and others'. */
  readonly profileOpen: boolean;
  readonly profileTab: BotProfileTab;
  readonly recordLocation: (
    input:
      | { readonly room: "code"; readonly href: string }
      | {
          readonly room: "bots";
          readonly location: BotLocation | null;
          readonly environmentId: EnvironmentId | null;
        },
  ) => void;
  /** Forgets a saved spot that no longer exists, unless a newer one replaced it. */
  readonly forgetBotLocation: (environmentId: EnvironmentId, href: string) => void;
  readonly setReturnToCodeThreadKey: (threadKey: string | null) => void;
  readonly setAssistantPanelOpen: (open: boolean) => void;
  readonly setCallTranscriptOpenFor: (callId: string | null) => void;
  readonly setProfileOpen: (open: boolean) => void;
  readonly setProfileTab: (tab: BotProfileTab) => void;
  readonly setAssistantDraft: (environmentId: EnvironmentId, draft: string) => void;
  /** Marks a send in flight and returns the draft it carries, or null if one already is. */
  readonly beginAssistantSend: (environmentId: EnvironmentId) => string | null;
  /**
   * Clears the draft only while it still holds what was sent, so text typed after reopening the
   * panel during the send survives.
   */
  readonly finishAssistantSend: (
    environmentId: EnvironmentId,
    submitted: string,
    outcome: { readonly sent: true } | { readonly sent: false; readonly error: string | null },
  ) => void;
}

export function readAssistantQuickState(
  state: Pick<BotRoomState, "assistantQuickByEnvironment">,
  environmentId: EnvironmentId,
): AssistantQuickState {
  return state.assistantQuickByEnvironment[environmentId] ?? EMPTY_ASSISTANT_QUICK_STATE;
}

export const useBotRoomStore = create<BotRoomState>()((set, get) => {
  const updateQuick = (
    environmentId: EnvironmentId,
    update: (current: AssistantQuickState) => AssistantQuickState,
  ) =>
    set((state) => ({
      assistantQuickByEnvironment: {
        ...state.assistantQuickByEnvironment,
        [environmentId]: update(readAssistantQuickState(state, environmentId)),
      },
    }));
  return {
    room: "code",
    environmentId: null,
    codeHref: null,
    botLocationByEnvironment: {},
    returnToCodeThreadKey: null,
    assistantPanelOpen: false,
    assistantQuickByEnvironment: {},
    assistantOrbSlot: null,
    callBarSlot: null,
    callTranscriptOpenFor: null,
    profileOpen: false,
    profileTab: "routines",
    recordLocation: (input) =>
      set((state) => {
        if (input.room === "code") {
          return {
            room: "code",
            codeHref: input.href,
            returnToCodeThreadKey: null,
          };
        }
        return {
          room: "bots",
          assistantPanelOpen: false,
          ...(input.environmentId === null ? {} : { environmentId: input.environmentId }),
          ...(input.environmentId === null || input.location === null
            ? {}
            : {
                botLocationByEnvironment: {
                  ...state.botLocationByEnvironment,
                  [input.environmentId]: input.location,
                },
              }),
        };
      }),
    forgetBotLocation: (environmentId, href) =>
      set((state) => {
        if (state.botLocationByEnvironment[environmentId]?.href !== href) return state;
        const { [environmentId]: _forgotten, ...rest } = state.botLocationByEnvironment;
        return { botLocationByEnvironment: rest };
      }),
    setReturnToCodeThreadKey: (returnToCodeThreadKey) => set({ returnToCodeThreadKey }),
    setAssistantPanelOpen: (assistantPanelOpen) => set({ assistantPanelOpen }),
    setCallTranscriptOpenFor: (callTranscriptOpenFor) => set({ callTranscriptOpenFor }),
    setProfileOpen: (profileOpen) => set({ profileOpen }),
    setProfileTab: (profileTab) => set({ profileTab }),
    setAssistantDraft: (environmentId, draft) =>
      updateQuick(environmentId, (current) => ({ ...current, draft })),
    beginAssistantSend: (environmentId) => {
      const current = readAssistantQuickState(get(), environmentId);
      if (current.sending || current.draft.trim().length === 0) return null;
      updateQuick(environmentId, () => ({ ...current, sending: true, error: null }));
      return current.draft;
    },
    finishAssistantSend: (environmentId, submitted, outcome) =>
      updateQuick(environmentId, (current) => ({
        draft: outcome.sent && current.draft === submitted ? "" : current.draft,
        sending: false,
        error: outcome.sent ? null : outcome.error,
      })),
  };
});

/**
 * A stable callback ref, so ChatView re-renders never reattach the slot. The cleanup clears only
 * its own element: a thread swap can attach the next slot before the previous one detaches.
 */
export function registerAssistantOrbSlot(element: HTMLElement | null) {
  if (element === null) return;
  useBotRoomStore.setState({ assistantOrbSlot: element });
  return () => {
    if (useBotRoomStore.getState().assistantOrbSlot === element) {
      useBotRoomStore.setState({ assistantOrbSlot: null });
    }
  };
}

/** Like the orb slot, keyed by the thread whose chat holds it; the compiler keeps one ref per key. */
export function callBarSlotRef(threadKey: string) {
  return (element: HTMLElement | null) => {
    if (element === null) return;
    const slot = { element, threadKey };
    useBotRoomStore.setState({ callBarSlot: slot });
    return () => {
      if (useBotRoomStore.getState().callBarSlot === slot) {
        useBotRoomStore.setState({ callBarSlot: null });
      }
    };
  };
}
