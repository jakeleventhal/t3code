import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type VoiceConnection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveBotCallAvailability, resolveBotCallStart } from "./bot-call";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");
const main = ThreadId.make("main");
const topic = ThreadId.make("topic");
const assistant = { id: "assistant", title: "Assistant", botRole: "assistant" } as const;
const fitness = { id: "fitness", title: "Fitness", botRole: "specialist" } as const;
const available = { kind: "available" } as const;
const live = (bot: typeof assistant | typeof fitness, environmentId = envA, threadId = main) =>
  ({
    callId: `call-${bot.id}`,
    environmentId,
    bot,
    threadRef: { environmentId, threadId },
    phase: "listening",
  }) as const;

describe("resolveBotCallStart", () => {
  it("returns to the live call from its own conversation instead of starting a second one", () => {
    expect(
      resolveBotCallStart({
        active: live(fitness),
        target: { environmentId: envA, bot: fitness, threadId: main },
        availability: { kind: "unavailable", reason: "Busy" },
      }),
    ).toEqual({ kind: "open-active" });
  });

  it("asks before moving a call to another conversation with the same bot", () => {
    expect(
      resolveBotCallStart({
        active: live(fitness),
        target: { environmentId: envA, bot: fitness, threadId: topic },
        availability: available,
      }),
    ).toMatchObject({ kind: "confirm-switch", replacingCallId: "call-fitness" });
  });

  it("asks before replacing a live call, naming the exact call it would end", () => {
    expect(
      resolveBotCallStart({
        active: live(assistant),
        target: { environmentId: envB, bot: assistant, threadId: main },
        availability: available,
      }),
    ).toMatchObject({ kind: "confirm-switch", replacingCallId: "call-assistant" });
  });

  it("replaces a failed call without asking, including calling the same conversation again", () => {
    const failed = { ...live(fitness), phase: "failed" } as const;
    for (const bot of [fitness, assistant]) {
      expect(
        resolveBotCallStart({
          active: failed,
          target: { environmentId: envA, bot, threadId: main },
          availability: available,
        }),
      ).toEqual({ kind: "start", replacingCallId: "call-fitness" });
    }
  });

  it("never offers a switch to a bot that cannot take a call", () => {
    expect(
      resolveBotCallStart({
        active: live(assistant),
        target: { environmentId: envA, bot: fitness, threadId: topic },
        availability: { kind: "unavailable", reason: "Voice isn’t available here", setup: true },
      }),
    ).toEqual({ kind: "unavailable", reason: "Voice isn’t available here", setup: true });
  });
});

describe("resolveBotCallAvailability", () => {
  const ready = { supported: true, connected: true, canCall: true } as const;
  const selection = { connectionId: "voice", model: "model", voice: "voice" };
  const openai: VoiceConnection = { kind: "openai-api", name: "OpenAI", apiKey: "saved" };

  it("allows a call through an OpenAI or xAI API account with a saved key", () => {
    const xai: VoiceConnection = { kind: "xai-api", name: "xAI", apiKey: "saved" };
    for (const connection of [openai, xai]) {
      expect(resolveBotCallAvailability({ ...ready, selection, connection })).toEqual({
        kind: "available",
      });
      expect(
        resolveBotCallAvailability({
          ...ready,
          selection,
          connection: { ...connection, apiKey: "" },
        }),
      ).toMatchObject({ kind: "unavailable", setup: true });
    }
  });

  it("allows a call through a linked ChatGPT sign-in; the server checks it on connect", () => {
    const subscription: VoiceConnection = {
      kind: "codex-subscription",
      name: "ChatGPT",
      providerInstanceId: ProviderInstanceId.make("codex"),
    };
    expect(resolveBotCallAvailability({ ...ready, selection, connection: subscription })).toEqual({
      kind: "available",
    });
  });

  it("reports server and connection problems before voice setup", () => {
    for (const blocked of [
      { supported: false },
      { connected: false },
      { canCall: false },
    ] as const) {
      const result = resolveBotCallAvailability({
        ...ready,
        ...blocked,
        selection: null,
        connection: undefined,
      });
      expect(result.kind).toBe("unavailable");
      expect(result).not.toHaveProperty("setup");
    }
  });
});
