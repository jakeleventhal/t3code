import { expect, it, vi } from "vite-plus/test";
import { attachVoiceCallCues } from "./cues.ts";
import type { VoiceCallState } from "./controller.ts";

it("plays once on connection and termination, not on speech changes or reconnection", () => {
  let state: VoiceCallState | null = null;
  let update = () => {};
  const play = vi.fn();
  const unsubscribe = vi.fn();
  const detach = attachVoiceCallCues(
    {
      getSnapshot: () => state,
      subscribe: (listener) => {
        update = listener;
        return unsubscribe;
      },
    },
    play,
  );
  const phase = (value: VoiceCallState["phase"]) => {
    state = { callId: "one", phase: value } as VoiceCallState;
    update();
  };
  phase("connecting");
  expect(play).not.toHaveBeenCalled();
  phase("listening");
  phase("speaking");
  phase("thinking");
  phase("reconnecting");
  phase("listening");
  expect(play.mock.calls).toEqual([["connected"]]);
  phase("failed");
  state = null;
  update();
  expect(play.mock.calls).toEqual([["connected"], ["ended"]]);
  phase("connecting");
  state = null;
  update();
  expect(play).toHaveBeenCalledTimes(2);
  detach();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
