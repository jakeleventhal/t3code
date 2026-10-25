import type { EnvironmentId, ProjectBotRole } from "@t3tools/contracts";

export interface AssistantEnvironmentCandidate {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly isEnabled: boolean;
  readonly connectionState: string;
  /** Whether the environment's server advertises bots. */
  readonly supportsBots: boolean;
}

interface AssistantRecord {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly botRole?: ProjectBotRole | null | undefined;
  readonly createdAt: string;
}

function olderFirst(left: AssistantRecord, right: AssistantRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/** An environment's Assistant is its oldest, the same one its server opens. */
export function environmentAssistant<P extends AssistantRecord>(
  projects: ReadonlyArray<P>,
  environmentId: EnvironmentId | null,
): P | null {
  let assistant: P | null = null;
  for (const project of projects) {
    if (project.environmentId !== environmentId || project.botRole !== "assistant") continue;
    if (assistant === null || olderFirst(project, assistant) < 0) assistant = project;
  }
  return assistant;
}

/**
 * Every Assistant on an environment, oldest first. Only the first is the environment's Assistant;
 * the rest predate that rule and stay listed so their conversations remain reachable.
 */
export function environmentAssistants<P extends AssistantRecord>(
  projects: ReadonlyArray<P>,
  environmentId: EnvironmentId | null,
): ReadonlyArray<P> {
  return projects
    .filter((project) => project.environmentId === environmentId && project.botRole === "assistant")
    .sort(olderFirst);
}

/**
 * The environment whose Assistant is the user's one Assistant. Every client and entry point
 * resolves it the same way, so the Bots list, the quick chat over Code and New bot's default host
 * all agree. The work on screen never picks it: what's being viewed travels as context instead.
 *
 * The oldest Assistant that exists stays designated while its host is offline, so a disconnect
 * never promotes another environment or creates a second Assistant there. Only with no Assistant
 * anywhere does a connected environment that supports bots get one, the first by name.
 */
export function chooseAssistantEnvironment(input: {
  readonly environments: ReadonlyArray<AssistantEnvironmentCandidate>;
  readonly projects: ReadonlyArray<AssistantRecord>;
}): EnvironmentId | null {
  const enabled = new Set(
    input.environments
      .filter((environment) => environment.isEnabled)
      .map((environment) => environment.environmentId),
  );
  const existing = input.projects
    .filter((project) => project.botRole === "assistant" && enabled.has(project.environmentId))
    .sort(olderFirst)[0];
  if (existing !== undefined) return existing.environmentId;
  const available = input.environments
    .filter(
      (environment) =>
        environment.supportsBots &&
        environment.isEnabled &&
        environment.connectionState === "connected",
    )
    .sort(
      (left, right) =>
        left.environmentLabel.localeCompare(right.environmentLabel) ||
        left.environmentId.localeCompare(right.environmentId),
    );
  return available[0]?.environmentId ?? null;
}
