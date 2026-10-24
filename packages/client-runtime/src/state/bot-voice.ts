import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcCommand,
  createAtomCommandScheduler,
} from "./runtime.ts";

export function createBotVoiceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { callId: string } }) =>
      JSON.stringify([environmentId, input.callId]),
  };
  return {
    readBrowserPage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:read-browser-page",
      tag: WS_METHODS.previewReadPage,
    }),
    startWork: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:voice-work",
      tag: WS_METHODS.botsVoiceWork,
    }),
    observeContext: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:bots:voice-observe",
      tag: WS_METHODS.botsVoiceObserve,
      idleTtlMs: 0,
    }),
    context: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:voice-context",
      tag: WS_METHODS.botsVoiceContext,
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:voice-connect",
      tag: WS_METHODS.botsVoiceConnect,
    }),
    begin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:voice-begin",
      tag: WS_METHODS.botsVoiceBegin,
      scheduler,
      concurrency,
    }),
    append: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:voice-append",
      tag: WS_METHODS.botsVoiceAppend,
      scheduler,
      concurrency,
    }),
    end: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:voice-end",
      tag: WS_METHODS.botsVoiceEnd,
      scheduler,
      concurrency,
    }),
    active: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:voice-active",
      tag: WS_METHODS.botsVoiceActive,
      staleTimeMs: 0,
    }),
    catalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:voice-catalog",
      tag: WS_METHODS.botsVoiceCatalog,
    }),
    transcriptPage: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:voice-transcript",
      tag: WS_METHODS.botsVoiceTranscript,
    }),
  };
}
