import { useAtomValue } from "@effect/atom-react";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { botRoutedModels, explicitBotTaskModels } from "@t3tools/shared/botPreferences";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { environmentThreadDetails } from "../../state/threads";

const NO_ROUTED_MODELS: ReadonlySet<string> = new Set();

/**
 * A small dashed chip naming the model the user asked for on this message. Ordinary routing,
 * quiet escalation to the complex-task model included, is never shown.
 */
export function BotTaskModels({
  threadRef,
  projectId,
  className,
}: {
  threadRef: ScopedThreadRef | null;
  projectId: ProjectId | null;
  className?: string;
}) {
  return threadRef ? (
    <ExplicitTaskModels threadRef={threadRef} projectId={projectId} className={className} />
  ) : null;
}

function ExplicitTaskModels({
  threadRef,
  projectId,
  className,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId | null;
  className: string | undefined;
}) {
  const routed = useAtomValue(
    serverEnvironment.settingsValueAtom(threadRef.environmentId),
    (settings) =>
      settings === null
        ? NO_ROUTED_MODELS
        : botRoutedModels(settings.botSharedPreferences, projectId),
  );
  const labels = useAtomValue(environmentThreadDetails.threadAtom(threadRef), (thread) =>
    explicitBotTaskModels(thread?.projection.subagents ?? [], routed).join(" · "),
  );
  if (!labels) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-0 items-center rounded-full border border-dashed px-2 text-2xs text-muted-foreground",
        className,
      )}
    >
      <span className="truncate">{labels} · this message</span>
    </span>
  );
}
