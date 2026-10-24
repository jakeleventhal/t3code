import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useParams,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { useCommittedLocation } from "./useCommittedLocation";

interface Sample {
  readonly locationHref: string;
  readonly committedHref: string | null;
  readonly threadId: string | undefined;
}

function createThreadRouter(gate: Promise<void>, samples: Sample[]) {
  function Probe() {
    const locationHref = useLocation({ select: (location) => location.href });
    const committedHref = useCommittedLocation()?.href ?? null;
    const threadId = useParams({ strict: false, select: (params) => params.threadId });
    useEffect(() => {
      samples.push({ locationHref, committedHref, threadId });
    }, [committedHref, locationHref, threadId]);
    return null;
  }
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Probe />
        <Outlet />
      </>
    ),
  });
  const thread = createRoute({
    getParentRoute: () => rootRoute,
    path: "$environmentId/$threadId",
    loader: ({ params }) => (params.threadId === "bot" ? gate : undefined),
  });
  return createRouter({
    routeTree: rootRoute.addChildren([thread]),
    history: createMemoryHistory({ initialEntries: ["/env/code"] }),
  });
}

describe("useCommittedLocation", () => {
  it("never pairs a navigation's destination with the route still on screen", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    const samples: Sample[] = [];
    const router = createThreadRouter(gate, samples);
    await router.load();
    await using _screen = await render(<RouterProvider router={router} />, { router: false });
    await vi.waitFor(() => expect(samples.at(-1)?.committedHref).toBe("/env/code"));

    let navigation!: Promise<void>;
    await act(async () => {
      navigation = router.navigate({ href: "/env/bot" });
    });
    // The hazard: the location already names the destination while params name the old route.
    await vi.waitFor(() => expect(samples.at(-1)?.locationHref).toBe("/env/bot"));
    expect(samples.at(-1)).toEqual({
      locationHref: "/env/bot",
      committedHref: null,
      threadId: "code",
    });

    await act(async () => {
      openGate();
      await navigation;
    });
    await vi.waitFor(() =>
      expect(samples.at(-1)).toMatchObject({ committedHref: "/env/bot", threadId: "bot" }),
    );
    for (const sample of samples) {
      if (sample.committedHref !== null) {
        expect(sample.committedHref).toBe(`/env/${sample.threadId}`);
      }
    }
  });
});
