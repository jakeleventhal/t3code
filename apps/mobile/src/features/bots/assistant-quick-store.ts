import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";

/** The quick Assistant chat for one environment; each environment has its own Assistant. */
export interface AssistantQuickState {
  /** Survives closing the sheet, like a composer draft. */
  readonly draft: string;
  readonly sending: boolean;
  readonly error: string | null;
}

export type AssistantSendOutcome =
  | { readonly sent: true }
  | { readonly sent: false; readonly error: string };

const EMPTY: AssistantQuickState = { draft: "", sending: false, error: null };

export function createAssistantQuickStore() {
  let states: Readonly<Record<string, AssistantQuickState>> = {};
  const listeners = new Set<() => void>();
  const read = (environmentId: EnvironmentId) => states[environmentId] ?? EMPTY;
  const update = (
    environmentId: EnvironmentId,
    next: (current: AssistantQuickState) => AssistantQuickState,
  ) => {
    states = { ...states, [environmentId]: next(read(environmentId)) };
    listeners.forEach((listener) => listener());
  };
  return {
    read,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDraft: (environmentId: EnvironmentId, draft: string) =>
      update(environmentId, (current) => ({ ...current, draft })),
    /** Marks a send in flight and returns the text it carries, or null if one already is. */
    beginSend: (environmentId: EnvironmentId): string | null => {
      const current = read(environmentId);
      const text = current.draft.trim();
      if (current.sending || text.length === 0) return null;
      update(environmentId, () => ({ ...current, sending: true, error: null }));
      return current.draft;
    },
    /** Clears the draft only while it still holds what was sent, so newer typing survives. */
    finishSend: (environmentId: EnvironmentId, submitted: string, outcome: AssistantSendOutcome) =>
      update(environmentId, (current) => ({
        draft: outcome.sent && current.draft === submitted ? "" : current.draft,
        sending: false,
        error: outcome.sent ? null : outcome.error,
      })),
  };
}

export const assistantQuickStore = createAssistantQuickStore();

export function useAssistantQuickState(environmentId: EnvironmentId): AssistantQuickState {
  const getSnapshot = useCallback(() => assistantQuickStore.read(environmentId), [environmentId]);
  return useSyncExternalStore(assistantQuickStore.subscribe, getSnapshot);
}
