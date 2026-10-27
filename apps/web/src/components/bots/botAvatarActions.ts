import { BOT_AVATAR_PROMPT_PREFIX } from "@t3tools/client-runtime/bot-avatar";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  type BotAvatarAssetPath,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";

import { randomUUID } from "~/lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { botEnvironment } from "../../state/bots";
import { toastManager } from "../ui/toast";
import { useBotRoomStore } from "./botRoomStore";

const QUIET = { reportFailure: false } as const;

function report(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
  return false;
}

/** Starts the live-animation flow from a typed description; the chat shows what happens next. */
export async function requestBotAvatarOptions(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly prompt: string;
}): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    botEnvironment.avatarGenerateOptions,
    {
      environmentId: input.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        projectId: input.projectId,
        prompt: input.prompt,
      },
    },
    QUIET,
  );
  return report("Couldn’t start generating avatar options", result);
}

export async function selectBotAvatarOption(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly version: string;
  readonly candidate: BotAvatarAssetPath;
}): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    botEnvironment.avatarSelectOption,
    {
      environmentId: input.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        projectId: input.projectId,
        version: input.version,
        candidate: input.candidate,
      },
    },
    QUIET,
  );
  return report("Couldn’t use that option", result);
}

export async function describeBotAvatarImage(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly prompt: string;
}): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    botEnvironment.avatarDescribeImage,
    {
      environmentId: input.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        projectId: input.projectId,
        prompt: input.prompt,
      },
    },
    QUIET,
  );
  return report("Couldn’t start generating the image", result);
}

export async function retryBotAvatar(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly version: string;
}): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    botEnvironment.avatarRetry,
    {
      environmentId: input.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        projectId: input.projectId,
        version: input.version,
      },
    },
    QUIET,
  );
  return report("Couldn’t retry", result);
}

export async function dismissBotAvatarJob(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    botEnvironment.avatarDismiss,
    {
      environmentId: input.environmentId,
      input: { commandId: CommandId.make(randomUUID()), projectId: input.projectId },
    },
    QUIET,
  );
  return report("Couldn’t dismiss", result);
}

/**
 * Live Animation begins in the conversation: the composer gets the opening phrase appended after
 * whatever draft is there, and the user finishes the sentence. The send pipeline recognises it.
 */
export function beginBotAvatarConversation(project: EnvironmentProject): boolean {
  const threadId = project.botMainThreadId ?? null;
  if (threadId === null) return false;
  useBotRoomStore
    .getState()
    .requestComposerPrefill(
      scopedThreadKey(scopeThreadRef(project.environmentId, threadId)),
      BOT_AVATAR_PROMPT_PREFIX,
    );
  return true;
}
