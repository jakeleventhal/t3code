export function createCallCuePlayer(input: {
  load: (cue: "connected" | "ended") => Promise<string>;
  play: (uri: string, ended: boolean) => void;
}) {
  let generation = 0;
  const loaded = new Map<string, Promise<string>>();
  const load = (cue: "connected" | "ended") => {
    let pending = loaded.get(cue);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => input.load(cue))
        .catch((error: unknown) => {
          loaded.delete(cue);
          throw error;
        });
      loaded.set(cue, pending);
    }
    return pending;
  };
  return async (cue: "connected" | "ended") => {
    const current = ++generation;
    try {
      // The end cue must be local before the user taps Hang up.
      if (cue === "connected") void load("ended").catch(() => undefined);
      const uri = await load(cue);
      if (current === generation) input.play(uri, cue === "ended");
    } catch {
      // An optional sound must never interrupt the call or claim the microphone.
    }
  };
}
