import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { invalidateReviewDiffPreviews, reviewDiffPreviewRevisionAtom } from "./review.ts";

const TARGET = {
  environmentId: EnvironmentId.make("environment-1"),
};

describe("review diff preview invalidation", () => {
  it("scopes revision changes to the invalidated environment", () => {
    const registry = AtomRegistry.make();
    const otherEnvironment = {
      environmentId: EnvironmentId.make("environment-2"),
    };

    expect(registry.get(reviewDiffPreviewRevisionAtom(TARGET))).toBe(0);
    expect(registry.get(reviewDiffPreviewRevisionAtom(otherEnvironment))).toBe(0);

    invalidateReviewDiffPreviews(registry, TARGET);

    expect(registry.get(reviewDiffPreviewRevisionAtom(TARGET))).toBe(1);
    expect(registry.get(reviewDiffPreviewRevisionAtom(otherEnvironment))).toBe(0);
    registry.dispose();
  });

  it("notifies reactive dependents without replacing their atom identity", () => {
    const registry = AtomRegistry.make();
    const dependent = Atom.make((get) => get(reviewDiffPreviewRevisionAtom(TARGET)));
    const unmount = registry.mount(dependent);

    expect(registry.get(dependent)).toBe(0);
    invalidateReviewDiffPreviews(registry, TARGET);
    expect(registry.get(dependent)).toBe(1);

    unmount();
    registry.dispose();
  });
});
