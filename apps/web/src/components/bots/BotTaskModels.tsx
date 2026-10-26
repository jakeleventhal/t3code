import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { activeBotTaskModels } from "@t3tools/shared/botPreferences";
import { environmentThreadDetails } from "../../state/threads";

export function BotTaskModels({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  return threadRef ? <ActiveTaskModels threadRef={threadRef} /> : null;
}

function ActiveTaskModels({ threadRef }: { threadRef: ScopedThreadRef }) {
  const labels = useAtomValue(environmentThreadDetails.threadAtom(threadRef), (thread) =>
    activeBotTaskModels(thread?.projection.subagents ?? []).join(" · "),
  );
  if (!labels) return null;
  return (
    <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
      Working with {labels}
    </div>
  );
}
