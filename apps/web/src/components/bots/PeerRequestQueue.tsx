import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  peerRequestPreview,
  type PeerRequestRow,
} from "@t3tools/client-runtime/state/peer-requests";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  BotIcon,
  CircleAlertIcon,
  Clock3Icon,
  CloudOffIcon,
  SendIcon,
  XIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { ComposerBanner } from "../chat/ComposerBanner";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useBotActions } from "./useBotActions";
import {
  useCancelPeerRequest,
  usePeerRequestCanCancel,
  usePeerRequestRows,
} from "./usePeerRequests";

function StateIcon({ row }: { row: PeerRequestRow }) {
  switch (row.state) {
    case "waiting":
      return <CloudOffIcon aria-hidden className="size-3 shrink-0" />;
    case "confirming":
      return <Clock3Icon aria-hidden className="size-3 shrink-0" />;
    case "setup":
    case "access":
      return <CircleAlertIcon aria-hidden className="size-3 shrink-0 text-warning-foreground" />;
    case "delivered":
      return <SendIcon aria-hidden className="size-3 shrink-0" />;
  }
}

/** The other conversation: who asked, or who was asked. A delivered request opens its work. */
function useCounterpart(row: PeerRequestRow) {
  const ref =
    row.direction === "incoming"
      ? row.item.sourceThreadId === null
        ? null
        : scopeThreadRef(row.hostEnvironmentId, row.item.sourceThreadId)
      : scopeThreadRef(row.item.environmentId, row.item.result?.threadId ?? row.item.threadId);
  const shell = useQuietThreadShell(ref);
  const machine =
    useEnvironmentPresentation(ref?.environmentId ?? null).presentation?.entry.target.label ?? null;
  const title =
    shell?.title ?? (row.direction === "incoming" ? row.item.sourceTitle : null) ?? null;
  const name = title === null ? (machine ? `a bot on ${machine}` : "another bot") : `“${title}”`;
  return {
    // Always a bot's request, never the user's own words.
    label: `${row.direction === "incoming" ? "From" : "To"} ${name}`,
    where: machine,
    // Only a conversation this client has seen can be opened.
    ref: shell === null ? null : ref,
  };
}

function Counterpart({ row, onNavigate }: { row: PeerRequestRow; onNavigate?: () => void }) {
  const counterpart = useCounterpart(row);
  const { openThread } = useBotActions();
  const ref = counterpart.ref;
  const content = (
    <>
      <BotIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{counterpart.label}</span>
    </>
  );
  if (ref === null) {
    return <span className="flex max-w-40 min-w-0 shrink-0 items-center gap-1">{content}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="flex max-w-40 min-w-0 shrink-0 items-center gap-1 rounded-sm hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
            onClick={() => {
              onNavigate?.();
              void openThread(ref);
            }}
          />
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {counterpart.where ? `Open conversation on ${counterpart.where}` : "Open conversation"}
      </TooltipPopup>
    </Tooltip>
  );
}

function Actions({
  row,
  size,
  onNavigate,
}: {
  row: PeerRequestRow;
  size: "icon-micro" | "icon-xs";
  onNavigate?: () => void;
}) {
  const canCancel = usePeerRequestCanCancel(row);
  const cancel = useCancelPeerRequest();
  const { openThread } = useBotActions();
  const result = row.state === "delivered" ? row.item.result : null;
  return (
    <>
      {result ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size={size}
                variant="ghost-muted"
                aria-label="Open conversation"
                onClick={() => {
                  onNavigate?.();
                  void openThread(scopeThreadRef(row.item.environmentId, result.threadId));
                }}
              />
            }
          >
            <ArrowUpRightIcon />
          </TooltipTrigger>
          <TooltipPopup>Open conversation</TooltipPopup>
        </Tooltip>
      ) : null}
      {canCancel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size={size}
                variant="ghost-muted"
                aria-label="Cancel request"
                onClick={() => void cancel(row)}
              />
            }
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup>Cancel request</TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
}

/** Bot-to-bot requests in Assistant's corner card, beside the unsent messages. */
export function PeerRequestCardList({
  environmentId,
  threadId,
  onNavigate,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId | null;
  onNavigate?: () => void;
}) {
  const rows = usePeerRequestRows(environmentId, threadId);
  if (rows.length === 0) return null;
  return (
    <ul aria-label="Requests between bots" className="flex flex-col gap-1 px-2.5 pb-1.5">
      {rows.map((row) => (
        <li
          key={row.key}
          className={cn(
            "flex flex-col gap-0.5 rounded-lg border border-dashed py-1 pr-1 pl-2 text-xs text-muted-foreground",
            (row.state === "setup" || row.state === "access") && "border-warning/40",
          )}
        >
          <div className="flex min-h-5 items-center gap-1.5">
            <StateIcon row={row} />
            <span className="shrink-0">{row.label}</span>
            <Counterpart row={row} {...(onNavigate ? { onNavigate } : {})} />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {peerRequestPreview(row.item)}
            </span>
            <Actions row={row} size="icon-micro" {...(onNavigate ? { onNavigate } : {})} />
          </div>
          {row.detail ? <p className="pr-1 wrap-anywhere">{row.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Bot-to-bot requests attached above a bot chat's composer, after its own queued messages. */
export function PeerRequestComposerBanner({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const rows = usePeerRequestRows(environmentId, threadId);
  if (rows.length === 0) return null;
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        role="region"
        aria-label={`${rows.length} request${rows.length === 1 ? "" : "s"} between bots`}
        aria-live="polite"
        variant={
          rows.some((row) => row.state === "setup" || row.state === "access")
            ? "warning"
            : "default"
        }
      >
        <ComposerBanner.Scroll className="max-h-32">
          <ComposerBanner.Children render={<ol />}>
            {rows.map((row) => (
              <li key={row.key} className="flex flex-col">
                <ComposerBanner.Row>
                  <ComposerBanner.Icon>
                    <StateIcon row={row} />
                  </ComposerBanner.Icon>
                  <ComposerBanner.Content className="text-foreground/80">
                    <span className="shrink-0 text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 text-muted-foreground">
                      <Counterpart row={row} />
                    </span>
                    <Tooltip>
                      <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                        {peerRequestPreview(row.item)}
                      </TooltipTrigger>
                      <TooltipPopup side="top" className="max-w-96 break-words">
                        {row.item.text}
                      </TooltipPopup>
                    </Tooltip>
                  </ComposerBanner.Content>
                  <ComposerBanner.Actions>
                    <Actions row={row} size="icon-xs" />
                  </ComposerBanner.Actions>
                </ComposerBanner.Row>
                {row.detail ? (
                  <p className="pb-1 ps-(--composer-banner-icon-column) pe-2 text-xs text-muted-foreground wrap-anywhere">
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
