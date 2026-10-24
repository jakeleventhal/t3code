import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botCallAnnouncement,
  botCallCanToggleMute,
  botCallPhaseLabel,
  resolveBotCallAvailability,
  resolveBotCallStart,
} from "./botCall.logic";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");
const assistant = { id: "assistant", title: "Assistant", botRole: "assistant" } as const;
const fitness = { id: "fitness", title: "Fitness", botRole: "specialist" } as const;
const available = { kind: "available" } as const;

describe("resolveBotCallStart", () => {
  const thread = (bot: { readonly id: string }) => ThreadId.make(`thread-${bot.id}`);
  const live = (bot: typeof assistant | typeof fitness, environmentId = envA) =>
    ({
      callId: `call-${bot.id}`,
      environmentId,
      bot,
      threadRef: { environmentId, threadId: thread(bot) },
      phase: "listening",
    }) as const;

  it("starts when no call is live", () => {
    expect(
      resolveBotCallStart({
        active: null,
        target: { environmentId: envA, bot: fitness, threadId: thread(fitness) },
        availability: available,
      }),
    ).toEqual({ kind: "start", replacingCallId: null });
  });

  it("returns to the live call instead of starting a second one with the same bot", () => {
    expect(
      resolveBotCallStart({
        active: live(fitness),
        target: { environmentId: envA, bot: fitness, threadId: thread(fitness) },
        availability: { kind: "unavailable", reason: "Busy" },
      }),
    ).toEqual({ kind: "open-active" });
  });

  it("asks before replacing a call with anyone else, naming the exact call it would end", () => {
    const decision = resolveBotCallStart({
      active: live(assistant),
      target: { environmentId: envB, bot: assistant, threadId: thread(assistant) },
      availability: available,
    });
    expect(decision).toMatchObject({ kind: "confirm-switch", replacingCallId: "call-assistant" });
    const other = resolveBotCallStart({
      active: live(assistant),
      target: { environmentId: envA, bot: fitness, threadId: thread(fitness) },
      availability: available,
    });
    expect(other).toMatchObject({ kind: "confirm-switch", activeBotTitle: "Assistant" });
  });

  it("asks before leaving a call for another topic with the same bot", () => {
    expect(
      resolveBotCallStart({
        active: live(fitness),
        target: { environmentId: envA, bot: fitness, threadId: ThreadId.make("thread-other") },
        availability: available,
      }),
    ).toMatchObject({ kind: "confirm-switch", replacingCallId: "call-fitness" });
  });

  it("replaces a failed call without asking, including calling the same bot again", () => {
    const failed = { ...live(fitness), phase: "failed" } as const;
    for (const bot of [fitness, assistant]) {
      expect(
        resolveBotCallStart({
          active: failed,
          target: { environmentId: envA, bot, threadId: thread(bot) },
          availability: available,
        }),
      ).toEqual({ kind: "start", replacingCallId: "call-fitness" });
    }
  });

  it("never offers a switch to a bot that cannot take a call", () => {
    expect(
      resolveBotCallStart({
        active: live(assistant),
        target: { environmentId: envA, bot: fitness, threadId: thread(fitness) },
        availability: { kind: "unavailable", reason: "Voice isn’t available here" },
      }),
    ).toEqual({ kind: "unavailable", reason: "Voice isn’t available here" });
  });
});

describe("resolveBotCallAvailability", () => {
  const ready = { supported: true, connected: true, canCall: true } as const;
  const selection = { connectionId: "main", model: "gpt-live-1", voice: "marin" } as const;
  const openai = { kind: "openai-api", name: "OpenAI", apiKey: "••••••" } as const;

  const xai = { kind: "xai-api", name: "xAI", apiKey: "••••••" } as const;

  const subscription = {
    kind: "codex-subscription",
    name: "ChatGPT",
    providerInstanceId: ProviderInstanceId.make("codex"),
  } as const;

  it("calls through an API account with a saved key or a linked ChatGPT sign-in", () => {
    for (const connection of [openai, xai, subscription]) {
      expect(resolveBotCallAvailability({ ...ready, selection, connection })).toEqual({
        kind: "available",
      });
    }
  });

  it("points voice problems at Voice settings without falling back to another account", () => {
    for (const connection of [{ ...openai, apiKey: "" }, { ...xai, apiKey: "" }, undefined]) {
      expect(resolveBotCallAvailability({ ...ready, selection, connection })).toMatchObject({
        kind: "unavailable",
        setup: true,
      });
    }
    expect(
      resolveBotCallAvailability({ ...ready, selection: null, connection: undefined }),
    ).toMatchObject({ kind: "unavailable", setup: true });
  });

  it("reports server, connection, and permission limits before the voice", () => {
    for (const blocked of [
      { supported: false },
      { connected: false },
      { canCall: false },
    ] as const) {
      const result = resolveBotCallAvailability({
        ...ready,
        ...blocked,
        selection,
        connection: openai,
      });
      expect(result.kind).toBe("unavailable");
      expect(result).not.toHaveProperty("setup");
    }
  });
});

describe("call status", () => {
  it("only allows muting once audio flows, and says so when muted", () => {
    expect(botCallCanToggleMute("connecting")).toBe(false);
    expect(botCallCanToggleMute("reconnecting")).toBe(false);
    expect(botCallCanToggleMute("speaking")).toBe(true);
    expect(botCallPhaseLabel("listening", true)).toBe("Muted");
    expect(botCallPhaseLabel("speaking", true)).toBe("Speaking");
  });
});

describe("call announcement", () => {
  const call = (phase: Parameters<typeof botCallPhaseLabel>[0], error: string | null = null) => ({
    phase,
    error,
    bot: fitness,
  });

  it("stays the same across turn-taking so live speech never re-announces", () => {
    const live = botCallAnnouncement(call("listening"));
    expect(live).toBe("Call with Fitness connected.");
    expect(botCallAnnouncement(call("thinking"))).toBe(live);
    expect(botCallAnnouncement(call("speaking"))).toBe(live);
  });

  it("announces connecting, reconnecting, and failure with its reason", () => {
    expect(botCallAnnouncement(call("connecting"))).toBe("Calling Fitness…");
    expect(botCallAnnouncement(call("reconnecting", "Network lost."))).toBe(
      "Reconnecting call with Fitness…",
    );
    expect(botCallAnnouncement(call("failed", "Voice connection lost."))).toBe(
      "Call with Fitness failed. Voice connection lost.",
    );
    expect(botCallAnnouncement(call("failed"))).toBe("Call with Fitness failed.");
    expect(botCallAnnouncement(null)).toBe("");
  });
});
