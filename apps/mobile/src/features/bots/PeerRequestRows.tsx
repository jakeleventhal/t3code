import { type PeerRequestRow } from "@t3tools/client-runtime/state/peer-requests";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import {
  useCancelPeerRequest,
  usePeerRequestCanCancel,
  usePeerRequestRows,
} from "../../state/peer-requests";
import { useOpenLinkedThread } from "../threads/useOpenLinkedThread";
import { peerRequestCounterpartLabel, peerRequestCounterpartRef } from "./peer-request-counterpart";

const STATE_ICON: Record<PeerRequestRow["state"], AppSymbolName> = {
  waiting: "wifi.slash",
  confirming: "circle.dashed",
  setup: "exclamationmark.triangle",
  access: "exclamationmark.triangle",
  delivered: "arrow.up.right",
};

function PeerRequestItem(props: { readonly row: PeerRequestRow }) {
  const { row } = props;
  const ref = peerRequestCounterpartRef(row);
  const shell = useQuietThreadShell(ref);
  const bot = useProjects().find(
    (project) =>
      project.environmentId === ref?.environmentId &&
      (project.id === shell?.projectId || project.botMainThreadId === ref?.threadId),
  );
  const label = peerRequestCounterpartLabel({ row, title: bot?.title ?? shell?.title ?? null });
  const openThread = useOpenLinkedThread();
  const canCancel = usePeerRequestCanCancel(row);
  const cancel = useCancelPeerRequest();
  // Only a conversation this client has seen can be opened.
  const target = shell === null ? null : ref;
  const warning = row.state === "setup" || row.state === "access";

  return (
    <View className="flex-row items-start gap-2 py-1.5">
      <View className="pt-0.5">
        <SymbolView
          name={STATE_ICON[row.state]}
          size={12}
          tintColorClassName={warning ? "accent-warning-foreground" : "accent-icon-muted"}
        />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="min-w-0 flex-row items-center gap-1.5">
          <Text className="shrink-0 text-xs text-foreground-muted">{row.label}</Text>
          <CounterpartLink label={label} target={target} onOpen={openThread} />
        </View>
        {row.detail ? <Text className="text-xs text-foreground-muted">{row.detail}</Text> : null}
      </View>
      {canCancel ? (
        <Button
          label="Cancel"
          tone="text"
          accessibilityLabel={`Cancel request ${label.toLowerCase()}`}
          onPress={() => void cancel(row)}
        />
      ) : null}
    </View>
  );
}

function CounterpartLink(props: {
  readonly label: string;
  readonly target: ScopedThreadRef | null;
  readonly onOpen: (target: ScopedThreadRef) => void;
}) {
  const { target } = props;
  if (target === null) {
    return (
      <Text className="min-w-0 shrink text-xs text-foreground-muted" numberOfLines={1}>
        {props.label}
      </Text>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint="Opens that conversation"
      hitSlop={6}
      onPress={() => props.onOpen(target)}
      className="min-w-0 shrink flex-row items-center gap-0.5 active:opacity-70"
    >
      <Text className="min-w-0 shrink text-xs text-foreground-secondary" numberOfLines={1}>
        {props.label}
      </Text>
      <SymbolView name="chevron.right" size={10} tintColorClassName="accent-chevron" />
    </Pressable>
  );
}

/** Bot-to-bot requests above a bot chat's composer, after its own queued messages. */
export function PeerRequestRows(props: { readonly thread: ScopedThreadRef }) {
  const rows = usePeerRequestRows(props.thread);
  if (rows.length === 0) return null;
  return (
    <View
      accessibilityLabel={`${rows.length} request${rows.length === 1 ? "" : "s"} between bots`}
      accessibilityLiveRegion="polite"
      className="mx-4 mb-2 rounded-2xl border border-dashed border-border bg-card px-3 py-1"
    >
      {rows.map((row) => (
        <PeerRequestItem key={row.key} row={row} />
      ))}
    </View>
  );
}
