import { BOT_AVATAR_PROMPT_PREFIX } from "@t3tools/client-runtime/bot-avatar";
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

import * as Dialog from "../../components/ui/Dialog";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { botEnvironment } from "../../state/bots";
import { appendComposerDraftText } from "../../state/use-composer-drafts";

const QUIET = { reportFailure: false } as const;

function report(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(title, error instanceof Error ? error.message : "Please try again.");
  }
  return false;
}

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
        commandId: CommandId.make(uuidv4()),
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
        commandId: CommandId.make(uuidv4()),
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
        commandId: CommandId.make(uuidv4()),
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
        commandId: CommandId.make(uuidv4()),
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
      input: { commandId: CommandId.make(uuidv4()), projectId: input.projectId },
    },
    QUIET,
  );
  return report("Couldn’t dismiss", result);
}

/**
 * Live Animation begins in the bot's main conversation: the opening phrase is appended to that
 * draft and the user finishes the sentence there. Returns the thread to open, or null.
 */
export function beginBotAvatarConversation(project: EnvironmentProject) {
  const threadId = project.botMainThreadId ?? null;
  if (threadId === null) return null;
  appendComposerDraftText(
    scopedThreadKey(project.environmentId, threadId),
    BOT_AVATAR_PROMPT_PREFIX,
  );
  return { environmentId: project.environmentId, threadId };
}
