import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export interface ReviewDiffPreviewInvalidationTarget {
  readonly environmentId: EnvironmentId;
}

const diffPreviewRevisionByEnvironment = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:review:diff-preview-revision:${environmentId}`),
  ),
);

export function reviewDiffPreviewRevisionAtom(target: ReviewDiffPreviewInvalidationTarget) {
  return diffPreviewRevisionByEnvironment(target.environmentId);
}

export function invalidateReviewDiffPreviews(
  registry: AtomRegistry.AtomRegistry,
  target: ReviewDiffPreviewInvalidationTarget,
): void {
  registry.update(reviewDiffPreviewRevisionAtom(target), (revision) => revision + 1);
}

export function createReviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    diffPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review:diff-preview",
      tag: WS_METHODS.reviewGetDiffPreview,
      staleTimeMs: 5_000,
      refreshSignal: reviewDiffPreviewRevisionAtom,
    }),
  };
}
