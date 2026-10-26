import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { activeBotTaskModels } from "@t3tools/shared/botPreferences";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { environmentThreadDetails } from "../../state/threads";
import { useProject, useQuietThreadShell } from "../../state/entities";

export function BotTaskModels({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(
    shell ? { environmentId: threadRef.environmentId, projectId: shell.projectId } : null,
  );
  const labels = useAtomValue(environmentThreadDetails.threadAtom(threadRef), (thread) =>
    activeBotTaskModels(thread?.projection.subagents ?? []).join(" · "),
  );
  if (!project?.botRole || !labels) return null;
  return (
    <View className="px-4 py-2" accessibilityLiveRegion="polite">
      <Text className="text-xs text-foreground-muted">Working with {labels}</Text>
    </View>
  );
}
