import { expect, it, vi } from "vite-plus/test";
import { createCallCuePlayer } from "./callCuePlayer";

it("drops a connection sound that loads after hang-up", async () => {
  const connection = Promise.withResolvers<string>();
  const play = vi.fn();
  const cue = createCallCuePlayer({
    load: (kind) => (kind === "connected" ? connection.promise : Promise.resolve("ended.wav")),
    play,
  });
  const pending = cue("connected");
  await cue("ended");
  connection.resolve("connected.wav");
  await pending;
  expect(play.mock.calls).toEqual([["ended.wav", true]]);
});

it("keeps missing or failed sounds from rejecting the call lifecycle", async () => {
  const cue = createCallCuePlayer({
    load: () => Promise.reject(new Error("missing")),
    play: vi.fn(),
  });
  await expect(cue("connected")).resolves.toBeUndefined();
  const failedPlayback = createCallCuePlayer({
    load: () => Promise.resolve("connected.wav"),
    play: () => {
      throw new Error("audio unavailable");
    },
  });
  await expect(failedPlayback("connected")).resolves.toBeUndefined();
});

it("preloads the end cue during connection and reuses it on hang-up", async () => {
  const load = vi.fn(async (kind: string) => `${kind}.wav`);
  const play = vi.fn();
  const cue = createCallCuePlayer({ load, play });
  await cue("connected");
  expect(load.mock.calls).toEqual([["ended"], ["connected"]]);
  await cue("ended");
  expect(load).toHaveBeenCalledTimes(2);
  expect(play.mock.calls).toEqual([
    ["connected.wav", false],
    ["ended.wav", true],
  ]);
});
