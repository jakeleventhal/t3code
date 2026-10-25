import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type AuthSessionState,
  EnvironmentAuthInvalidError,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  answeredGrantAllows,
  answeredSessionGrant,
  forgetSessionGrant,
  rememberSessionGrant,
  rememberedSessionGrant,
} from "./answeredSessionGrants";

const session = {
  authenticated: true,
  scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
} as unknown as AuthSessionState;
const answered = AsyncResult.success(session);

describe("answeredSessionGrant", () => {
  it("keeps the last answer when the host can't be reached, and nothing when it never answered", () => {
    const unreachable = AsyncResult.failure(Cause.fail(new Error("Network error")), {
      previousSuccess: Option.some(answered),
    });
    expect(
      answeredGrantAllows(answeredSessionGrant(unreachable), AuthOrchestrationOperateScope, 0),
    ).toBe(true);
    expect(answeredSessionGrant(AsyncResult.initial())).toBeNull();
  });

  it("treats a refused credential as no grant, even after an earlier answer", () => {
    const refused = AsyncResult.failure(
      Cause.fail(
        new EnvironmentAuthInvalidError({
          code: "auth_invalid",
          reason: "invalid_credential",
          traceId: "trace",
        }),
      ),
      { previousSuccess: Option.some(answered) },
    );
    expect(answeredSessionGrant(refused)).toEqual({ scopes: [], expiresAt: null });
    const signedOut = AsyncResult.success({ ...session, authenticated: false });
    expect(
      answeredGrantAllows(answeredSessionGrant(signedOut), AuthOrchestrationOperateScope, 0),
    ).toBe(false);
  });

  it("stops granting once the session expires", () => {
    const grant = { scopes: [AuthOrchestrationOperateScope], expiresAt: 1_000 };
    expect(answeredGrantAllows(grant, AuthOrchestrationOperateScope, 999)).toBe(true);
    expect(answeredGrantAllows(grant, AuthOrchestrationOperateScope, 1_000)).toBe(false);
  });
});

describe("remembered session grants", () => {
  it("replaces each answer with the next, so a narrowed grant is what a reload sees", () => {
    const environmentId = EnvironmentId.make("env-remembered");
    rememberSessionGrant(environmentId, {
      scopes: [AuthOrchestrationOperateScope],
      expiresAt: null,
    });
    rememberSessionGrant(environmentId, { scopes: [AuthOrchestrationReadScope], expiresAt: null });
    expect(
      answeredGrantAllows(rememberedSessionGrant(environmentId), AuthOrchestrationOperateScope, 0),
    ).toBe(false);
    forgetSessionGrant(environmentId);
    expect(rememberedSessionGrant(environmentId)).toBeNull();
  });
});
