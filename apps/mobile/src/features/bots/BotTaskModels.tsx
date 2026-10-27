import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { botRoutedModels, explicitBotTaskModels } from "@t3tools/shared/botPreferences";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentThreadDetails } from "../../state/threads";
import { useEnvironmentServerConfig, useProject, useQuietThreadShell } from "../../state/entities";

const NO_ROUTED_MODELS: ReadonlySet<string> = new Set();

/**
 * A small dashed chip naming the model the user asked for on this message. Ordinary routing,
 * quiet escalation to the complex-task model included, is never shown.
 */
export function BotTaskModels({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(
    shell ? { environmentId: threadRef.environmentId, projectId: shell.projectId } : null,
  );
  const preferences = useEnvironmentServerConfig(threadRef.environmentId)?.settings
    .botSharedPreferences;
  const routed =
    preferences === undefined || project === null
      ? NO_ROUTED_MODELS
      : botRoutedModels(preferences, project.id);
  const labels = useAtomValue(environmentThreadDetails.threadAtom(threadRef), (thread) =>
    explicitBotTaskModels(thread?.projection.subagents ?? [], routed).join(" · "),
  );
  if (!project?.botRole || !labels) return null;
  return (
    <View className="flex-row px-4 py-1.5" accessibilityLiveRegion="polite">
      <View className="h-6 max-w-full flex-row items-center rounded-full border border-dashed border-border bg-card px-2.5">
        <Text textRole="label" numberOfLines={1} className="text-foreground-muted">
          {labels} · this message
        </Text>
      </View>
    </View>
  );
}
