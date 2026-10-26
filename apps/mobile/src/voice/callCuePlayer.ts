export function createCallCuePlayer(input: {
  load: (cue: "connected" | "ended") => Promise<string>;
  play: (uri: string, ended: boolean) => void;
}) {
  let generation = 0;
  return async (cue: "connected" | "ended") => {
    const current = ++generation;
    try {
      const uri = await input.load(cue);
      if (current === generation) input.play(uri, cue === "ended");
    } catch {
      // An optional sound must never interrupt the call or claim the microphone.
    }
  };
}
