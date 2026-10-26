import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { createBotVoiceEnvironmentAtoms } from "@t3tools/client-runtime/state/bot-voice";
import {
  mergeVoiceTranscriptPages,
  readVoiceTranscriptPages,
  voiceTranscriptPagesToRefresh,
  type VoiceTranscriptPageRead,
} from "@t3tools/client-runtime/work-log/voice-call";
import type {
  EnvironmentId,
  ServerSettings,
  ServerSettingsPatch,
  ThreadId,
  VoiceCatalog,
  VoiceTranscriptEntry,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useEffect, useRef, useState } from "react";

import { useRunScopedSettingsPlan } from "../components/settings/useScopedSettings";
import { connectionAtomRuntime } from "../connection/runtime";
import { useServerConfigs } from "./entities";
import { formatEnvironmentQueryError } from "./query";

export const botVoiceEnvironment = createBotVoiceEnvironmentAtoms(connectionAtomRuntime);

/** Absent on servers that predate voice settings; they would drop every voice write. */
export function useEnvironmentSupportsVoiceSettings(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.botVoiceConfiguration === true
  );
}

/** Live calls need a server that advertises them, not only voice settings. */
export function useEnvironmentSupportsBotVoice(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null && configs.get(environmentId)?.environment.capabilities.botVoice === true
  );
}

// The catalog is derived from saved accounts, so any account edit, from this
// client or another, has to re-read it rather than wait out the stale time.
function voiceConnectionsSignature(connections: ServerSettings["voiceConnections"]): string {
  return JSON.stringify(
    Object.entries(connections)
      .map(([id, connection]) => [
        id,
        connection.kind,
        connection.name,
        connection.kind === "codex-subscription"
          ? connection.providerInstanceId
          : connection.apiKey.length > 0,
      ])
      .toSorted(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

export function useVoiceCatalog(
  environmentId: EnvironmentId,
  connections: ServerSettings["voiceConnections"],
): { readonly catalog: VoiceCatalog | null; readonly error: string | null } {
  const registry = useContext(RegistryContext);
  const atom = botVoiceEnvironment.catalog({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const signature = voiceConnectionsSignature(connections);
  const lastSignature = useRef(signature);
  // oxlint-disable-next-line t3code/react-effect-budget -- Invalidate the remote voice catalog after provider connections change.
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    registry.refresh(atom);
  }, [atom, registry, signature]);
  return {
    catalog: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
  };
}

export interface VoiceCallTranscriptView {
  readonly entries: ReadonlyArray<VoiceTranscriptEntry>;
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

const NO_TRANSCRIPT_PAGES = Atom.make<ReadonlyArray<VoiceTranscriptPageRead<never>>>([]);

/**
 * A call's words, a bounded page at a time. Nothing is requested until `target` is set, so a
 * collapsed card costs nothing; pages already read stay put while a later one loads or retries.
 * Cached words are re-read once each time the card opens and when the call ends while open.
 */
export function useVoiceCallTranscript(
  target: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly callId: string;
    readonly ended: boolean;
  } | null,
): VoiceCallTranscriptView {
  const registry = useContext(RegistryContext);
  const [pageCount, setPageCount] = useState(1);
  const environmentId = target?.environmentId ?? null;
  const threadId = target?.threadId ?? null;
  const callId = target?.callId ?? null;
  const ended = target?.ended ?? false;
  const pagesAtom =
    environmentId === null || threadId === null || callId === null
      ? NO_TRANSCRIPT_PAGES
      : Atom.make((get) =>
          readVoiceTranscriptPages({ threadId, callId, pageCount }, (input) =>
            get(botVoiceEnvironment.transcriptPage({ environmentId, input })),
          ),
        );
  // Acts when the card opens or its call ends, not when another page is added.
  const lastSync = useRef<{ readonly key: string; readonly ended: boolean } | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- Refresh persisted transcript pages when a call opens or ends outside this component.
  useEffect(() => {
    if (environmentId === null || threadId === null || callId === null) {
      lastSync.current = null;
      return;
    }
    const key = JSON.stringify([environmentId, threadId, callId]);
    const previous = lastSync.current;
    if (previous?.key === key && previous.ended === ended) return;
    lastSync.current = { key, ended };
    const reason = previous?.key === key ? "end" : "open";
    for (const input of voiceTranscriptPagesToRefresh(registry.get(pagesAtom), reason)) {
      registry.refresh(botVoiceEnvironment.transcriptPage({ environmentId, input }));
    }
  }, [environmentId, threadId, callId, ended, pagesAtom, registry]);
  const history = mergeVoiceTranscriptPages(useAtomValue(pagesAtom));
  return {
    entries: history.entries,
    status: history.status,
    error: history.status === "error" ? formatEnvironmentQueryError(history.cause) : null,
    hasMore: history.status === "ready" && !history.complete,
    loadMore: () => setPageCount((count) => count + 1),
    retry: () => {
      if (history.status !== "error" || environmentId === null) return;
      registry.refresh(botVoiceEnvironment.transcriptPage({ environmentId, input: history.retry }));
    },
  };
}

/** Writes one environment's settings with the shared permission check, drop detection, and toasts. */
export function useWriteEnvironmentSettings() {
  const run = useRunScopedSettingsPlan();
  return (
    environment: { readonly environmentId: EnvironmentId; readonly label: string },
    previous: ServerSettings,
    patch: ServerSettingsPatch,
  ) =>
    run({
      clientPatch: {},
      hasClientWrite: false,
      serverWrites: [
        { environmentId: environment.environmentId, label: environment.label, previous, patch },
      ],
      unavailableReason: null,
    });
}
