import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

interface FilterProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly repositoryIdentity?: { readonly canonicalKey?: string | undefined } | null | undefined;
}

function distinguishTitles<Project extends FilterProject>(
  projects: ReadonlyArray<Project>,
  suffix: (project: Project) => string,
  needsSuffix: (project: Project) => boolean = () => false,
) {
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.title, (counts.get(project.title) ?? 0) + 1);
  }
  return projects.map((project) =>
    (counts.get(project.title) ?? 0) > 1 || needsSuffix(project)
      ? { ...project, title: `${project.title} · ${suffix(project)}` }
      : project,
  );
}

export function pullRequestFilterProjects<Project extends FilterProject>(
  projects: ReadonlyArray<Project>,
  environmentLabels: ReadonlyMap<EnvironmentId, string>,
  selectedProject?: { readonly id: string; readonly environmentId: string },
) {
  const byRepository = new Map<string, Project>();
  for (const project of projects) {
    const repository = project.repositoryIdentity?.canonicalKey?.toLowerCase();
    const key = JSON.stringify([
      project.environmentId,
      repository ? ["repository", repository] : ["project", project.id],
    ]);
    const selected =
      project.id === selectedProject?.id && project.environmentId === selectedProject.environmentId;
    if (!byRepository.has(key) || selected) byRepository.set(key, project);
  }

  const repositoryEnvironments = new Map<string, Set<EnvironmentId>>();
  for (const project of byRepository.values()) {
    const repository = project.repositoryIdentity?.canonicalKey?.toLowerCase();
    if (!repository) continue;
    const environments = repositoryEnvironments.get(repository) ?? new Set<EnvironmentId>();
    environments.add(project.environmentId);
    repositoryEnvironments.set(repository, environments);
  }
  const byServer = distinguishTitles(
    [...byRepository.values()],
    (project) => environmentLabels.get(project.environmentId) ?? project.environmentId,
    (project) =>
      (repositoryEnvironments.get(project.repositoryIdentity?.canonicalKey?.toLowerCase() ?? "")
        ?.size ?? 0) > 1,
  );
  const byPath = distinguishTitles(byServer, (project) => project.workspaceRoot);
  const byEnvironment = distinguishTitles(byPath, (project) => project.environmentId);
  return distinguishTitles(byEnvironment, (project) => project.id).sort((left, right) =>
    left.title.localeCompare(right.title),
  );
}
