import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OrchestrationV2Subagent } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useEnvironmentServerConfig, useProject, useThreadShell } from "../../state/entities";
import { resolveSubagentMetadata } from "@t3tools/client-runtime/state/subagent-display";

/** Uses shell data already held by the client, without loading child transcripts. */
export function SubagentMetadata(props: {
  readonly environmentId: EnvironmentId;
  readonly subagent: Pick<
    OrchestrationV2Subagent,
    "threadId" | "childThreadId" | "model" | "driver" | "providerInstanceId"
  >;
}) {
  const { environmentId, subagent } = props;
  const config = useEnvironmentServerConfig(environmentId);
  const provider = config?.providers.find(
    (candidate) => candidate.instanceId === subagent.providerInstanceId,
  );
  const parent = useThreadShell(scopeThreadRef(environmentId, subagent.threadId))?.source;
  const child = useThreadShell(
    subagent.childThreadId === null ? null : scopeThreadRef(environmentId, subagent.childThreadId),
  )?.source;
  const parentProject = useProject(
    parent ? scopeProjectRef(environmentId, parent.projectId) : null,
  );
  const childProject = useProject(child ? scopeProjectRef(environmentId, child.projectId) : null);
  const { modelLabel, workspace } = resolveSubagentMetadata({
    model: subagent.model,
    provider,
    parentThread: parent,
    childThread: child,
    parentProject,
    childProject,
  });
  return (
    <View className="gap-0.5">
      <View className="min-w-0 flex-row items-center gap-1.5">
        <ProviderIcon
          provider={provider?.driver ?? subagent.driver}
          iconUrl={provider?.iconUrl}
          size={12}
        />
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={2}>
          {provider?.displayName ? `${provider.displayName} · ` : ""}
          {modelLabel}
        </Text>
      </View>
      {workspace.map(({ label, value }) => (
        <Text key={label} className="text-xs text-foreground-muted" numberOfLines={2}>
          {label}: {value}
        </Text>
      ))}
    </View>
  );
}
