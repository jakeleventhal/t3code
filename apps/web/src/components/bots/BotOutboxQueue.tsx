import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { CircleAlertIcon, Clock3Icon, CloudOffIcon, RotateCcwIcon, XIcon } from "lucide-react";

import { useStore } from "zustand";

import { botOutbox, useBotOutboxRows } from "../../botOutbox/botOutbox";
import type { BotOutboxItem, BotOutboxRow } from "../../botOutbox/botOutbox.logic";
import { environmentCatalog } from "../../connection/catalog";
import { useEnvironmentIds } from "../../state/environments";
import { cn } from "../../lib/utils";
import { useEnvironmentPresentation } from "../../state/presentation";
import { ComposerBanner } from "../chat/ComposerBanner";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** What the user wrote, with context links shown by name. */
export function botOutboxItemText(item: BotOutboxItem): string {
  return assistantCitationsToPlainText(
    replaceComposerContextReferences(item.text, (reference) => reference.label),
  ).trim();
}

export function botOutboxItemPreview(item: BotOutboxItem): string {
  const count = item.attachments.length;
  const attachments = count === 0 ? "" : count === 1 ? "1 attachment" : `${count} attachments`;
  return [botOutboxItemText(item), attachments].filter(Boolean).join(" · ");
}

function rowPreview(row: BotOutboxRow): string {
  return botOutboxItemPreview(row.item);
}

function RowIcon({ row }: { row: BotOutboxRow }) {
  switch (row.state) {
    case "sending":
      return <Spinner size="xs" tone="muted" />;
    case "failed":
      return (
        <CircleAlertIcon aria-hidden className="size-3 shrink-0 text-destructive-foreground" />
      );
    case "waiting-connection":
      return <CloudOffIcon aria-hidden className="size-3 shrink-0" />;
    case "waiting":
    case "blocked":
      return <Clock3Icon aria-hidden className="size-3 shrink-0" />;
  }
}

export function cancelBotOutboxItem(messageId: MessageId) {
  void botOutbox.cancel(messageId).then(
    (result) => {
      if (result === "gone") {
        toastManager.add(
          stackedThreadToast({ type: "info", title: "That message was already sent." }),
        );
      }
    },
    (error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t cancel the message",
          description: error instanceof Error ? error.message : undefined,
        }),
      );
    },
  );
}

function retry(row: BotOutboxRow) {
  void botOutbox.retry(row.item.messageId).catch((error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn’t retry the message",
        description: error instanceof Error ? error.message : undefined,
      }),
    );
  });
}

function RowActions({ row, size }: { row: BotOutboxRow; size: "icon-micro" | "icon-xs" }) {
  return (
    <>
      {row.canRetry ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size={size}
                variant="ghost-muted"
                aria-label="Retry sending"
                onClick={() => retry(row)}
              />
            }
          >
            <RotateCcwIcon />
          </TooltipTrigger>
          <TooltipPopup>Retry sending</TooltipPopup>
        </Tooltip>
      ) : null}
      {row.canCancel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size={size}
                variant="ghost-muted"
                aria-label="Cancel unsent message"
                onClick={() => cancelBotOutboxItem(row.item.messageId)}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup>
            {row.item.uncertain ? "Stop sending (it may already have arrived)" : "Cancel"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
}

/**
 * Unsent messages for a machine no longer in this app's list. No chat shows them, so Bot
 * settings does; adding the machine back sends them.
 */
export function useRemovedMachineBotOutboxItems(): ReadonlyArray<BotOutboxItem> {
  const catalogReady = useAtomValue(environmentCatalog.catalogValueAtom).isReady;
  const environmentIds = useEnvironmentIds();
  const items = useStore(botOutbox.store, (state) => state.items);
  if (!catalogReady) return [];
  return items.filter((item) => !environmentIds.includes(item.environmentId));
}

function useRows(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const hostLabel =
    useEnvironmentPresentation(environmentId).presentation?.entry.target.label ?? null;
  return useBotOutboxRows(environmentId, threadId, hostLabel);
}

/** Unsent messages in Assistant's corner card, above its composer. */
export function BotOutboxCardList({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
}) {
  const rows = useRows(environmentId, threadId);
  if (rows.length === 0) return null;
  return (
    <ul aria-label="Unsent messages" className="flex flex-col gap-1 px-2.5 pb-1.5">
      {rows.map((row) => (
        <li
          key={row.item.messageId}
          className={cn(
            "flex flex-col gap-0.5 rounded-lg border border-dashed py-1 pr-1 pl-2 text-xs text-muted-foreground",
            row.state === "failed" && "border-destructive/40",
          )}
        >
          <div className="flex min-h-5 items-center gap-1.5">
            <RowIcon row={row} />
            <span className="shrink-0">{row.label}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{rowPreview(row)}</span>
            <RowActions row={row} size="icon-micro" />
          </div>
          {row.detail ? (
            <p
              className={cn(
                "pr-1 wrap-anywhere",
                row.state === "failed" && "text-destructive-foreground",
              )}
            >
              {row.detail}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Unsent messages attached above a bot chat's composer, ahead of the host's own queue. */
export function BotOutboxComposerBanner({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const rows = useRows(environmentId, threadId);
  if (rows.length === 0) return null;
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        role="region"
        aria-label={`${rows.length} unsent message${rows.length === 1 ? "" : "s"}`}
        aria-live="polite"
        variant={rows.some((row) => row.state === "failed") ? "error" : "default"}
      >
        <ComposerBanner.Scroll className="max-h-32">
          <ComposerBanner.Children render={<ol />}>
            {rows.map((row) => (
              <li key={row.item.messageId} className="flex flex-col">
                <ComposerBanner.Row>
                  <ComposerBanner.Icon>
                    <RowIcon row={row} />
                  </ComposerBanner.Icon>
                  <ComposerBanner.Content className="text-foreground/80">
                    <span className="shrink-0 text-muted-foreground">{row.label}</span>
                    <Tooltip>
                      <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                        {rowPreview(row)}
                      </TooltipTrigger>
                      <TooltipPopup side="top" className="max-w-96 break-words">
                        {rowPreview(row)}
                      </TooltipPopup>
                    </Tooltip>
                  </ComposerBanner.Content>
                  <ComposerBanner.Actions>
                    <RowActions row={row} size="icon-xs" />
                  </ComposerBanner.Actions>
                </ComposerBanner.Row>
                {row.detail ? (
                  <p
                    className={cn(
                      "pb-1 ps-(--composer-banner-icon-column) pe-2 text-xs wrap-anywhere",
                      row.state === "failed"
                        ? "text-destructive-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {row.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ComposerBanner.Children>
        </ComposerBanner.Scroll>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
