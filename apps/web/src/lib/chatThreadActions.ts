import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
  startFromOrigin: boolean;
}

type NewThreadHandler = (
  projectRef: ScopedProjectRef,
  options?: {
    branch?: string | null;
    worktreePath?: string | null;
    envMode?: DraftThreadEnvMode;
    startFromOrigin?: boolean;
  },
) => Promise<void>;

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
  readonly defaultThreadEnvMode?: DraftThreadEnvMode;
  readonly defaultNewWorktreesStartFromOrigin?: boolean;
  readonly defaultMainCheckout?: {
    readonly branch: string;
    readonly path: string | null;
  } | null;
  readonly resolveDefaultMainCheckout?: (
    projectRef: ScopedProjectRef,
  ) => Promise<{ readonly branch: string; readonly path: string | null } | null | undefined>;
}

async function resolveMainCheckout(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<{
  readonly branch: string;
  readonly path: string | null;
} | null> {
  if (!context.resolveDefaultMainCheckout) {
    return context.defaultMainCheckout ?? null;
  }
  try {
    return (
      (await context.resolveDefaultMainCheckout(projectRef)) ?? context.defaultMainCheckout ?? null
    );
  } catch {
    return context.defaultMainCheckout ?? null;
  }
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function buildContextualThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    branch: context.activeThread?.branch ?? context.activeDraftThread?.branch ?? null,
    worktreePath:
      context.activeThread?.worktreePath ?? context.activeDraftThread?.worktreePath ?? null,
    envMode:
      context.activeDraftThread?.envMode ??
      (context.activeThread?.worktreePath ? "worktree" : "local"),
    ...(context.activeDraftThread
      ? { startFromOrigin: context.activeDraftThread.startFromOrigin }
      : {}),
  };
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  if (context.defaultThreadEnvMode === undefined) {
    await context.handleNewThread(projectRef);
    return;
  }

  const threadEnvMode: DraftThreadEnvMode = context.defaultThreadEnvMode;
  const mainCheckout = await resolveMainCheckout(context, projectRef);
  await context.handleNewThread(projectRef, {
    branch: mainCheckout?.branch ?? null,
    worktreePath: threadEnvMode === "local" ? (mainCheckout?.path ?? null) : null,
    envMode: threadEnvMode,
    startFromOrigin: resolveNewDraftStartFromOrigin({
      envMode: threadEnvMode,
      newWorktreesStartFromOrigin: context.defaultNewWorktreesStartFromOrigin ?? false,
    }),
  });
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewThreadInProjectFromContext(context, projectRef);
  return true;
}

export async function startNewThreadInSameWorktreeFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef, buildContextualThreadOptions(context));
  return true;
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  const mainCheckout = await resolveMainCheckout(context, projectRef);

  await context.handleNewThread(projectRef, {
    branch: mainCheckout?.branch ?? null,
    worktreePath: mainCheckout?.path ?? null,
    envMode: "local",
    startFromOrigin: false,
  });
  return true;
}
