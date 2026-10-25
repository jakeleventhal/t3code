import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import {
  type AuthEnvironmentScope,
  type AuthSessionState,
  type EnvironmentId,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  answeredGrantAllows,
  answeredSessionGrant,
  rememberSessionGrant,
  rememberedSessionGrant,
} from "./answeredSessionGrants";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";

export const environmentSession = createEnvironmentSessionAtoms(connectionAtomRuntime);
export const environmentSessionStatesAtom = environmentAtomList(
  "web-environment-session-states",
  environmentSession.sessionStateAtom,
);

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

export function useEnvironmentScope(
  environmentId: EnvironmentId | null,
  scope: AuthEnvironmentScope,
): boolean {
  const result = useAtomValue(
    environmentId === null
      ? EMPTY_SESSION_STATE_ATOM
      : environmentSession.sessionStateAtom(environmentId),
  );
  return sessionHasScope(result, scope);
}

export function sessionHasScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
): boolean {
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

const environmentsWithScopeAtom = Atom.family((key: string) => {
  const [scope, idsKey = ""] = key.split(/\n(.*)/s) as [AuthEnvironmentScope, string?];
  const ids = idsKey === "" ? [] : (idsKey.split("\n") as EnvironmentId[]);
  const statesAtom = environmentSessionStatesAtom(idsKey);
  return Atom.make((get) => {
    const states = get(statesAtom);
    return new Set(ids.filter((_, index) => sessionHasScope(states[index]!, scope)));
  }).pipe(Atom.withLabel(`web-environments-with-scope:${key}`));
});

export function useEnvironmentsWithScope(
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  scope: AuthEnvironmentScope,
): ReadonlySet<EnvironmentId> {
  return useAtomValue(
    environmentsWithScopeAtom(
      `${scope}\n${environmentIdsKey(environments.map(({ environmentId }) => environmentId))}`,
    ),
  );
}

export function readEnvironmentScope(
  environmentId: EnvironmentId,
  scope: AuthEnvironmentScope,
): boolean {
  return sessionHasScope(
    appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId)),
    scope,
  );
}

function lastKnownScope(
  environmentId: EnvironmentId | null,
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthEnvironmentScope,
): boolean {
  if (environmentId === null) return false;
  const grant = answeredSessionGrant(result) ?? rememberedSessionGrant(environmentId);
  return answeredGrantAllows(grant, scope, Date.now());
}

/**
 * The grant from the last session read that answered, in this page or, after a reload while the
 * host is unreachable, an earlier one. A read that failed to reach the host doesn't revoke it; a
 * refused or expired credential does. Only for keeping a message on this device: delivery checks
 * the live grant and the host checks again.
 */
export function readLastKnownEnvironmentScope(
  environmentId: EnvironmentId,
  scope: AuthEnvironmentScope,
): boolean {
  return lastKnownScope(
    environmentId,
    appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId)),
    scope,
  );
}

export function useLastKnownEnvironmentScope(
  environmentId: EnvironmentId | null,
  scope: AuthEnvironmentScope,
): boolean {
  const result = useAtomValue(
    environmentId === null
      ? EMPTY_SESSION_STATE_ATOM
      : environmentSession.sessionStateAtom(environmentId),
  );
  return lastKnownScope(environmentId, result, scope);
}

/** Keeps each connected host's latest session answer for a reload that finds it unreachable. */
export function useRememberSessionGrants(environmentIds: ReadonlyArray<EnvironmentId>): void {
  useEffect(() => {
    const stops = environmentIds.map((environmentId) => {
      const atom = environmentSession.sessionStateAtom(environmentId);
      const remember = () => {
        const grant = answeredSessionGrant(appAtomRegistry.get(atom));
        if (grant !== null) rememberSessionGrant(environmentId, grant);
      };
      const stop = appAtomRegistry.subscribe(atom, remember);
      remember();
      return stop;
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, [environmentIds]);
}

const EMPTY_PREPARED_CONNECTION_ATOM = Atom.make(Option.none()).pipe(
  Atom.withLabel("web-prepared-connection:empty"),
);

export function usePreparedConnection(environmentId: EnvironmentId | null) {
  return useAtomValue(
    environmentId === null
      ? EMPTY_PREPARED_CONNECTION_ATOM
      : environmentSession.preparedConnectionValueAtom(environmentId),
  );
}

export function readPreparedConnection(environmentId: EnvironmentId) {
  return Option.getOrNull(
    appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
  );
}

/** data survives SWR revalidation; isPending applies only before first resolve. */
export function useEnvironmentSessionState(environmentId: EnvironmentId) {
  const result = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    hasError: result._tag === "Failure",
    isPending: result.waiting,
  };
}
