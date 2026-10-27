import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { readAssistantQuickState, useBotRoomStore } from "./botRoomStore";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");
const quick = (environmentId: EnvironmentId) =>
  readAssistantQuickState(useBotRoomStore.getState(), environmentId);

describe("assistant quick panel state", () => {
  beforeEach(() => {
    useBotRoomStore.setState({ assistantQuickByEnvironment: {}, botLocationByEnvironment: {} });
  });

  it("keeps each environment's draft private", () => {
    const store = useBotRoomStore.getState();
    store.setAssistantDraft(envA, "about env A");
    expect(quick(envB).draft).toBe("");
    expect(store.beginAssistantSend(envB)).toBeNull();
    expect(quick(envA).draft).toBe("about env A");
  });

  it("allows one send at a time and clears the draft it sent on success", () => {
    const store = useBotRoomStore.getState();
    store.setAssistantDraft(envA, "hello");
    expect(store.beginAssistantSend(envA)).toBe("hello");
    expect(store.beginAssistantSend(envA)).toBeNull();
    expect(quick(envA).sending).toBe(true);
    store.finishAssistantSend(envA, "hello", { sent: true });
    expect(quick(envA)).toEqual({ draft: "", sending: false, error: null });
  });

  it("keeps text typed after the send started, and only touches the sending environment", () => {
    const store = useBotRoomStore.getState();
    store.setAssistantDraft(envA, "first");
    store.setAssistantDraft(envB, "other");
    const submitted = store.beginAssistantSend(envA)!;
    store.setAssistantDraft(envA, "follow-up");
    store.finishAssistantSend(envA, submitted, { sent: true });
    expect(quick(envA).draft).toBe("follow-up");
    expect(quick(envB)).toEqual({ draft: "other", sending: false, error: null });
  });

  it("keeps the draft and reports the error when the send fails", () => {
    const store = useBotRoomStore.getState();
    store.setAssistantDraft(envA, "retry me");
    const submitted = store.beginAssistantSend(envA)!;
    store.finishAssistantSend(envA, submitted, { sent: false, error: "Offline" });
    expect(quick(envA)).toEqual({ draft: "retry me", sending: false, error: "Offline" });
    store.beginAssistantSend(envA);
    expect(quick(envA).error).toBeNull();
  });
});

describe("saved Bots locations", () => {
  it("forgets a stale spot only while it is still the saved one", () => {
    const store = useBotRoomStore.getState();
    const location = (href: string) => ({
      href,
      target: { kind: "server" as const, threadRef: scopeThreadRef(envA, ThreadId.make(href)) },
    });
    store.recordLocation({ room: "bots", environmentId: envA, location: location("/old") });
    store.recordLocation({ room: "bots", environmentId: envA, location: location("/new") });
    store.forgetBotLocation(envA, "/old");
    expect(useBotRoomStore.getState().botLocationByEnvironment[envA]?.href).toBe("/new");
    store.forgetBotLocation(envA, "/new");
    expect(useBotRoomStore.getState().botLocationByEnvironment[envA]).toBeUndefined();
  });
});

describe("Code return location", () => {
  it.each(["/settings", "/settings/bots?tab=voice", "/usage#models"])(
    "does not replace the Code thread with %s",
    (href) => {
      const store = useBotRoomStore.getState();
      store.recordLocation({ room: "code", href: "/env/code-thread" });
      store.recordLocation({ room: "bots", environmentId: envA, location: null });
      store.recordLocation({ room: "code", href });
      expect(useBotRoomStore.getState().codeHref).toBe("/env/code-thread");
      expect(useBotRoomStore.getState().room).toBe("bots");
    },
  );
});
