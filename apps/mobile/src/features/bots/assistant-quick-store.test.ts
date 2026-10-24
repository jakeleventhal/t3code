import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createAssistantQuickStore } from "./assistant-quick-store";

const home = EnvironmentId.make("environment-home");
const work = EnvironmentId.make("environment-work");

describe("quick Assistant chat", () => {
  it("keeps each environment's draft across closes, privately", () => {
    const store = createAssistantQuickStore();
    store.setDraft(home, "What changed on main?");
    expect(store.read(home).draft).toBe("What changed on main?");
    expect(store.read(work).draft).toBe("");
  });

  it("allows one send at a time and clears what it sent on success", () => {
    const store = createAssistantQuickStore();
    store.setDraft(home, "Summarize #2214");
    const submitted = store.beginSend(home);
    expect(submitted).toBe("Summarize #2214");
    // Reopening the sheet and tapping Send again must not queue a duplicate.
    expect(store.beginSend(home)).toBeNull();
    store.finishSend(home, submitted!, { sent: true });
    expect(store.read(home)).toEqual({ draft: "", sending: false, error: null });
  });

  it("keeps text typed while the send was in flight, touching only that environment", () => {
    const store = createAssistantQuickStore();
    store.setDraft(home, "First");
    store.setDraft(work, "Other");
    const submitted = store.beginSend(home)!;
    store.setDraft(home, "First, and then");
    store.finishSend(home, submitted, { sent: true });
    expect(store.read(home)).toEqual({ draft: "First, and then", sending: false, error: null });
    expect(store.read(work)).toEqual({ draft: "Other", sending: false, error: null });
  });

  it("keeps the draft and its error when the send fails, and clears the error on retry", () => {
    const store = createAssistantQuickStore();
    store.setDraft(home, "Hello");
    store.finishSend(home, store.beginSend(home)!, { sent: false, error: "Disconnected" });
    expect(store.read(home)).toEqual({ draft: "Hello", sending: false, error: "Disconnected" });
    expect(store.beginSend(home)).toBe("Hello");
    expect(store.read(home).error).toBeNull();
  });

  it("does not send whitespace", () => {
    const store = createAssistantQuickStore();
    store.setDraft(home, "   ");
    expect(store.beginSend(home)).toBeNull();
    expect(store.read(home).sending).toBe(false);
  });
});
