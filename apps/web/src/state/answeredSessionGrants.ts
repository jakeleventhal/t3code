import {
  AuthEnvironmentScope,
  type AuthSessionState,
  type EnvironmentId,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:answered-session-grants:v1";

const AnsweredSessionGrant = Schema.Struct({
  /** Empty when the host refused the credential. */
  scopes: Schema.Array(AuthEnvironmentScope),
  expiresAt: Schema.NullOr(Schema.Number),
});
export type AnsweredSessionGrant = typeof AnsweredSessionGrant.Type;

const AnsweredSessionGrants = Schema.Record(Schema.String, AnsweredSessionGrant);

const REVOKED: AnsweredSessionGrant = { scopes: [], expiresAt: null };

/** The host turned the credential down, as opposed to not being reachable to ask. */
function refusesCredential(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return false;
  if (error._tag === "EnvironmentAuthInvalidError") return true;
  // A relay credential the host rejected even after renewal carries that answer as its cause.
  return (
    error._tag === "RemoteEnvironmentAuthFetchError" &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "authenticated" in error.cause &&
    error.cause.authenticated === false
  );
}

/**
 * What a session read says the host granted: its latest answer, a refusal, or null when it has
 * never answered (usually because it is unreachable).
 */
export function answeredSessionGrant(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
): AnsweredSessionGrant | null {
  if (result._tag === "Failure" && refusesCredential(Cause.squash(result.cause))) return REVOKED;
  const session = Option.getOrNull(AsyncResult.value(result));
  if (session === null) return null;
  return {
    scopes: AuthEnvironmentScope.literals.filter((scope) => sessionGrantsScope(session, scope)),
    expiresAt: session.expiresAt === undefined ? null : DateTime.toEpochMillis(session.expiresAt),
  };
}

export function answeredGrantAllows(
  grant: AnsweredSessionGrant | null,
  scope: AuthEnvironmentScope,
  now: number,
): boolean {
  return grant !== null && grant.scopes.includes(scope) && (grant.expiresAt ?? Infinity) > now;
}

let remembered: Record<string, AnsweredSessionGrant> | null = null;

function rememberedGrants(): Record<string, AnsweredSessionGrant> {
  if (remembered === null) {
    try {
      remembered = { ...getLocalStorageItem(STORAGE_KEY, AnsweredSessionGrants) };
    } catch {
      remembered = {};
    }
  }
  return remembered;
}

function writeRemembered(next: Record<string, AnsweredSessionGrant>) {
  remembered = next;
  try {
    setLocalStorageItem(STORAGE_KEY, next, AnsweredSessionGrants);
  } catch (error) {
    console.warn("[session] could not remember the session grant", error);
  }
}

/** The last answer from an earlier page load, for a host that hasn't answered in this one. */
export function rememberedSessionGrant(environmentId: EnvironmentId): AnsweredSessionGrant | null {
  return rememberedGrants()[environmentId] ?? null;
}

/** Every answer replaces the last, so a narrowed or refused grant is what a reload sees. */
export function rememberSessionGrant(
  environmentId: EnvironmentId,
  grant: AnsweredSessionGrant,
): void {
  const current = rememberedGrants();
  const previous = current[environmentId];
  if (
    previous !== undefined &&
    previous.expiresAt === grant.expiresAt &&
    previous.scopes.length === grant.scopes.length &&
    previous.scopes.every((scope) => grant.scopes.includes(scope))
  ) {
    return;
  }
  writeRemembered({ ...current, [environmentId]: grant });
}

export function forgetSessionGrant(environmentId: EnvironmentId): void {
  const current = rememberedGrants();
  if (!(environmentId in current)) return;
  const { [environmentId]: _, ...rest } = current;
  writeRemembered(rest);
}
