import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createBotEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { environmentId: string }) => environmentId,
  };
  return {
    files: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:files",
      tag: WS_METHODS.botsFiles,
      staleTimeMs: 0,
      idleTtlMs: 60_000,
    }),
    setAvatar: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:set-avatar",
      tag: WS_METHODS.botsSetAvatar,
      scheduler,
      concurrency,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:open",
      tag: WS_METHODS.botsOpen,
      scheduler,
      concurrency,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:create",
      tag: WS_METHODS.botsCreate,
      scheduler,
      concurrency,
    }),
  };
}
