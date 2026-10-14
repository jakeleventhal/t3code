import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";

export type WorkspacePane = "git" | "files";
const rememberedPane = Atom.family((key: string) =>
  Atom.make<WorkspacePane | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`mobile:workspace:pane:${key}`),
  ),
);

export function readWorkspacePane(key: string) {
  return appAtomRegistry.get(rememberedPane(key));
}
export function rememberWorkspacePane(key: string, pane: WorkspacePane) {
  appAtomRegistry.set(rememberedPane(key), pane);
}

/** The first ready status chooses a pane once; later Git updates preserve that choice. */
export function resolveWorkspacePane(
  current: WorkspacePane | null,
  changedFiles: number | undefined,
): WorkspacePane | null {
  if (current !== null) return current;
  return changedFiles === undefined ? null : changedFiles > 0 ? "git" : "files";
}
