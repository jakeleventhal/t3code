import {
  peerRequestRows,
  type PeerRequestDirection,
  type PeerRequestRow,
} from "@t3tools/client-runtime/state/peer-requests";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  type PeerMessageOutboxItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { peerRequestCounterpartLabel, peerRequestCounterpartRef } from "./peer-request-counterpart";

const SOURCE_HOST = EnvironmentId.make("laptop");
const DESTINATION = EnvironmentId.make("server");
const NOW = Date.parse("2026-10-24T12:00:00.000Z");

function row(
  direction: PeerRequestDirection,
  item: Partial<PeerMessageOutboxItem> = {},
): PeerRequestRow {
  const [only] = peerRequestRows(
    [
      {
        hostEnvironmentId: SOURCE_HOST,
        direction,
        item: {
          requestId: CommandId.make("request-1"),
          sourceThreadId: ThreadId.make("researcher-main"),
          sourceTitle: "Researcher",
          environmentId: DESTINATION,
          threadId: ThreadId.make("builder-main"),
          text: "Check the nightly build",
          createdAt: "2026-10-24T11:50:00.000Z",
          updatedAt: "2026-10-24T11:50:00.000Z",
          status: "pending",
          uncertain: false,
          result: null,
          error: null,
          ...item,
        },
      },
    ],
    NOW,
  );
  if (only === undefined) throw new Error("expected a row");
  return only;
}

describe("peerRequestCounterpartRef", () => {
  it("opens the requesting conversation on its own host", () => {
    expect(peerRequestCounterpartRef(row("incoming"))).toEqual({
      environmentId: SOURCE_HOST,
      threadId: ThreadId.make("researcher-main"),
    });
    expect(peerRequestCounterpartRef(row("incoming", { sourceThreadId: null }))).toBeNull();
  });

  it("opens the work a delivered request started, not just the addressed conversation", () => {
    expect(peerRequestCounterpartRef(row("outgoing"))?.threadId).toBe("builder-main");
    const delivered = row("outgoing", {
      status: "delivered",
      createdAt: "2026-10-24T11:50:00.000Z",
      updatedAt: "2026-10-24T11:55:00.000Z",
      result: {
        threadId: ThreadId.make("builder-nightly"),
        messageId: MessageId.make("message-1"),
        runId: null,
        status: "running",
        delivery: "started",
      },
    });
    expect(peerRequestCounterpartRef(delivered)).toEqual({
      environmentId: DESTINATION,
      threadId: ThreadId.make("builder-nightly"),
    });
  });
});

describe("peerRequestCounterpartLabel", () => {
  it("names the other bot, falling back from what this device knows to the request itself", () => {
    expect(
      peerRequestCounterpartLabel({ row: row("incoming"), title: "Research", machine: null }),
    ).toBe("From “Research”");
    expect(peerRequestCounterpartLabel({ row: row("incoming"), title: null, machine: null })).toBe(
      "From “Researcher”",
    );
    expect(
      peerRequestCounterpartLabel({
        row: row("incoming", { sourceTitle: "" }),
        title: null,
        machine: "Laptop",
      }),
    ).toBe("From another bot");
    expect(
      peerRequestCounterpartLabel({ row: row("outgoing"), title: null, machine: "Server" }),
    ).toBe("To another bot");
    expect(peerRequestCounterpartLabel({ row: row("outgoing"), title: null, machine: null })).toBe(
      "To another bot",
    );
  });
});
