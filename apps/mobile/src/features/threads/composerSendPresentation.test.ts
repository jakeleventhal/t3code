import { describe, expect, it } from "vite-plus/test";

import { resolveComposerSendPresentation } from "./composerSendPresentation";

const idle = {
  editingQueuedMessage: false,
  running: false,
  canSteer: false,
  followUpBehavior: "queue",
  deliveryDeferred: false,
} as const;

describe("resolveComposerSendPresentation", () => {
  it("shows the outbox action when delivery is deferred", () => {
    const presentation = resolveComposerSendPresentation({ ...idle, deliveryDeferred: true });
    expect(presentation.label).toBe("Queue");
    expect(presentation.icon).toBe("tray.and.arrow.up");
    expect(resolveComposerSendPresentation(idle).icon).toBe("arrow.up");
  });

  it("never promises steering the provider cannot do", () => {
    const presentation = resolveComposerSendPresentation({
      ...idle,
      running: true,
      canSteer: false,
      followUpBehavior: "steer",
    });

    expect(presentation.label).toBe("Queue");
    expect(presentation.action).toBe("queue");
    expect(presentation.alternate).toBeNull();
    expect(presentation.offersFollowUpChoice).toBe(false);
  });
});

it("bots send into ongoing work without a queue/restart menu", () => {
  const result = resolveComposerSendPresentation({ ...idle, bot: true, running: true });
  expect(result).toMatchObject({
    label: "Send",
    action: "steer",
    alternate: null,
    offersFollowUpChoice: false,
  });
  expect(
    resolveComposerSendPresentation({ ...idle, bot: true, running: true, deliveryDeferred: true }),
  ).toMatchObject({ label: "Queue", action: null, offersFollowUpChoice: false });
});
