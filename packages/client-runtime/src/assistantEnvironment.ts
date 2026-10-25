import type { BotSharedPreferences, EnvironmentId, ProjectBotRole } from "@t3tools/contracts";

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
  readonly botReplicaReady?: boolean | undefined;
}

function olderFirst(left: AssistantRecord, right: AssistantRecord): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id) ||
    left.environmentId.localeCompare(right.environmentId)
  );
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
 * The oldest Assistant defines the identity. A ready replica can serve it when its preferred
 * environment is unavailable. Unrelated older Assistants remain historical conversations.
 */
export function chooseAssistantEnvironment(input: {
  readonly environments: ReadonlyArray<AssistantEnvironmentCandidate>;
  readonly projects: ReadonlyArray<AssistantRecord>;
  readonly preferences?: BotSharedPreferences | undefined;
}): EnvironmentId | null {
  const enabled = new Set(
    input.environments
      .filter((environment) => environment.isEnabled)
      .map((environment) => environment.environmentId),
  );
  const existing = input.projects
    .filter((project) => project.botRole === "assistant" && enabled.has(project.environmentId))
    .sort(olderFirst)[0];
  if (existing !== undefined) {
    return (
      chooseBotReplica({
        projects: input.projects.filter((project) => project.id === existing.id),
        environments: input.environments,
        ...(input.preferences ? { preferences: input.preferences } : {}),
      })?.environmentId ?? existing.environmentId
    );
  }
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

/** Select only copies of the same identity; an unrelated local Assistant is never a fallback. */
export function chooseBotReplica<P extends AssistantRecord>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly environments: ReadonlyArray<AssistantEnvironmentCandidate>;
  readonly preferences?: BotSharedPreferences | undefined;
}): P | null {
  const original = [...input.projects].sort(olderFirst)[0];
  if (!original) return null;
  const preferred =
    input.preferences?.overrides[original.id as keyof BotSharedPreferences["overrides"]] ??
    input.preferences?.primaryEnvironmentId;
  const available = input.projects.filter(
    (project) =>
      project.id === original.id &&
      project.botReplicaReady !== false &&
      input.environments.some(
        (env) =>
          env.environmentId === project.environmentId &&
          env.isEnabled &&
          env.connectionState === "connected",
      ),
  );
  return (
    available.find((project) => project.environmentId === preferred) ??
    available.find((project) => project.environmentId === original.environmentId) ??
    available.sort((a, b) => a.environmentId.localeCompare(b.environmentId))[0] ??
    original
  );
}

export function latestBotPreferences(
  values: Iterable<BotSharedPreferences>,
): BotSharedPreferences | undefined {
  return [...values].sort(
    (a, b) => b.revision - a.revision || (b.author ?? "").localeCompare(a.author ?? ""),
  )[0];
}

export function selectBotReplicas<P extends AssistantRecord>(input: {
  readonly projects: ReadonlyArray<P>;
  readonly environments: ReadonlyArray<AssistantEnvironmentCandidate>;
  readonly preferences?: BotSharedPreferences | undefined;
}): ReadonlyArray<P> {
  const groups = new Map<string, P[]>();
  const ordinary: P[] = [];
  for (const project of input.projects) {
    if (project.botRole == null) {
      ordinary.push(project);
      continue;
    }
    const group = groups.get(project.id) ?? [];
    group.push(project);
    groups.set(project.id, group);
  }
  return [
    ...ordinary,
    ...Array.from(groups.values()).flatMap((projects) => {
      const selected = chooseBotReplica({ ...input, projects });
      return selected ? [selected] : [];
    }),
  ];
}
