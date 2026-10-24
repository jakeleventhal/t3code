import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

export interface AssistantEnvironmentCandidate {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly isEnabled: boolean;
  readonly connectionState: string;
  /** Whether the environment's server advertises bots. */
  readonly supportsBots: boolean;
}

/**
 * Each environment has its own Assistant, so the quick chat needs one environment. The
 * environment the Code list is filtered to always wins, even while it is offline or too old for
 * bots: its Assistant explains why it can't open rather than sending a private conversation to
 * another machine. Without a filter, a connected environment that already has an Assistant is
 * preferred, so a second environment never gains one just because it sorts first.
 */
export function chooseAssistantEnvironment(input: {
  readonly environments: ReadonlyArray<AssistantEnvironmentCandidate>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<Pick<EnvironmentProject, "environmentId" | "botRole">>;
}): EnvironmentId | null {
  const selected = input.environments.find(
    (environment) => environment.environmentId === input.selectedEnvironmentId,
  );
  if (selected) return selected.environmentId;
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
  const withAssistant = available.find((environment) =>
    input.projects.some(
      (project) =>
        project.environmentId === environment.environmentId && project.botRole === "assistant",
    ),
  );
  return (withAssistant ?? available[0])?.environmentId ?? null;
}
