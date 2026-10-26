import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeVoiceThreadContext } from "./thread-context.ts";

type Context = NonNullable<Parameters<typeof describeVoiceThreadContext>[0]>;
const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
): Context["messages"][number] => ({
  id: MessageId.make(id),
  role,
  text,
  streaming: false,
  createdBy: role === "user" ? "user" : "agent",
});

describe("current thread voice context", () => {
  it("distinguishes unknown PR data from an empty linked list and mixed states", () => {
    expect(describeVoiceThreadContext(null)).toBeNull();
    expect(describeVoiceThreadContext({ thread: {}, messages: [] })).toContain(
      "Linked PRs: not loaded",
    );
    expect(describeVoiceThreadContext({ thread: { pullRequests: [] }, messages: [] })).toContain(
      "Linked PRs: 0 total",
    );
    const context = describeVoiceThreadContext({
      thread: {
        pullRequests: [
          { snapshot: { state: "open" } },
          { snapshot: { state: "open" } },
          { snapshot: { state: "closed" } },
          { snapshot: { state: "merged" } },
          { snapshot: null },
        ],
      },
      messages: [],
    });
    expect(context).toContain("5 total; 2 open, 1 closed, 1 merged, 1 unknown");
  });

  it("keeps completed visible messages stable while a reply streams, excluding call machinery", () => {
    const messages = [
      message("user", "user", "Compare these."),
      message("answer", "assistant", "Here is the comparison."),
    ];
    const initial = describeVoiceThreadContext({ thread: {}, messages });
    const during = describeVoiceThreadContext({
      thread: {},
      messages: [
        ...messages,
        { ...message("stream", "assistant", "Partial new answer"), streaming: true },
        message("voice-work:call", "user", "Internal handoff"),
        {
          ...message("call", "assistant", "Checking"),
          voiceCall: { callId: "call", entryId: "entry", ordinal: 0, revision: 1, final: true },
        },
        { ...message("relay", "user", "Internal relay"), createdBy: "agent" },
      ],
    });
    expect(during).toBe(initial);
    expect(initial).toContain('"Here is the comparison."');
    const complete = describeVoiceThreadContext({
      thread: {},
      messages: [...messages, message("new", "assistant", "New result.")],
    });
    expect(complete).toContain('"New result."');
    expect(complete).not.toContain("Here is the comparison.");
  });

  it("does not substitute an older answer when the latest message text was omitted", () => {
    const context = describeVoiceThreadContext({
      thread: {},
      messages: [
        message("old", "assistant", "Outdated answer"),
        { ...message("latest", "assistant", ""), textOmitted: true },
      ],
    });
    expect(context).toContain("Last completed assistant message: not loaded");
    expect(context).not.toContain("Outdated answer");
  });

  it("bounds long messages while retaining the final sentence and valid Unicode", () => {
    const context = describeVoiceThreadContext({
      thread: {},
      messages: [
        message("latest", "assistant", "😀".repeat(5000) + " Final sentence."),
        message("user", "user", "x".repeat(5000)),
      ],
    })!;
    expect(context.length).toBeLessThan(2500);
    expect(context).toContain("ending only; beginning omitted");
    expect(context).toContain("Final sentence.");
    expect(context).not.toMatch(/\\ud[89ab][0-9a-f]{2}|\\ud[cdef][0-9a-f]{2}/i);
  });
});
