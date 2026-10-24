import { useRouterState } from "@tanstack/react-router";

/**
 * The location once the router has committed it, else null. `useLocation` moves to a navigation's
 * destination as soon as it starts, while route params keep naming the route still on screen
 * until its matches commit, so pairing the two describes a route that doesn't exist.
 */
export function useCommittedLocation(): {
  readonly pathname: string;
  readonly href: string;
} | null {
  const pathname = useRouterState({
    select: (state) => (state.status === "idle" ? state.location.pathname : null),
  });
  const href = useRouterState({
    select: (state) => (state.status === "idle" ? state.location.href : null),
  });
  return pathname === null || href === null ? null : { pathname, href };
}
