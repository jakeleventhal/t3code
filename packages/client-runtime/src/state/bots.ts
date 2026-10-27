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
    configure: createEnvironmentRpcCommand(runtime, {
      label: "bots:configure",
      tag: WS_METHODS.botsConfigure,
      scheduler,
      concurrency,
    }),
    replicationStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "bots:replication-status",
      tag: WS_METHODS.botsReplicationStatus,
      staleTimeMs: 0,
      idleTtlMs: 60_000,
    }),
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
    avatarCapabilities: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:avatar-capabilities",
      tag: WS_METHODS.botsAvatarCapabilities,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    avatarGenerateOptions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:avatar-generate-options",
      tag: WS_METHODS.botsAvatarGenerateOptions,
      scheduler,
      concurrency,
    }),
    avatarSelectOption: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:avatar-select-option",
      tag: WS_METHODS.botsAvatarSelectOption,
      scheduler,
      concurrency,
    }),
    avatarDescribeImage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:avatar-describe-image",
      tag: WS_METHODS.botsAvatarDescribeImage,
      scheduler,
      concurrency,
    }),
    avatarRetry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:avatar-retry",
      tag: WS_METHODS.botsAvatarRetry,
      scheduler,
      concurrency,
    }),
    avatarDismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:avatar-dismiss",
      tag: WS_METHODS.botsAvatarDismiss,
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
