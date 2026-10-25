import type { BotFileContextRecord, ProjectContextRecord } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { BotIcon, FileIcon, FolderIcon, ImageIcon } from "lucide-react";

import { useProject } from "~/state/entities";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** A Code project or bot named in a bot chat. A bot opens its main conversation. */
export function ProjectReferenceChip(props: {
  record: ProjectContextRecord;
  copyMarkdown?: string;
}) {
  const { environmentId, projectId, mainThreadId } = props.record;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const title = project?.title.trim() || props.record.title;
  const isBot = props.record.botRole !== null;
  const kindLabel = props.record.botRole === "assistant" ? "Assistant" : isBot ? "Bot" : "Project";
  const content = (
    <>
      {isBot ? <BotIcon /> : <FolderIcon />}
      <ContextChipLabel>{title}</ContextChipLabel>
    </>
  );
  const chipProps = {
    kind: "thread" as const,
    "aria-label": `${kindLabel}, ${title}`,
    "data-markdown-copy": props.copyMarkdown,
  };
  if (!isBot || mainThreadId === undefined || project === null) {
    return (
      <Tooltip>
        <TooltipTrigger render={<ContextChip {...chipProps}>{content}</ContextChip>} />
        <TooltipPopup side="top">
          {project ? kindLabel : `${kindLabel} not available here`}
        </TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            {...chipProps}
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: mainThreadId }}
              />
            }
            className="no-underline"
          >
            {content}
          </ContextChip>
        }
      />
      <TooltipPopup side="top">Open {title}</TooltipPopup>
    </Tooltip>
  );
}

/** A file from a bot's Files; it opens the conversation it was shared or published in. */
export function BotFileReferenceChip(props: {
  record: BotFileContextRecord;
  copyMarkdown?: string;
}) {
  const { environmentId, sourceThreadId } = props.record;
  const isImage = props.record.mimeType?.startsWith("image/") === true;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind={isImage ? "image" : "file"}
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: sourceThreadId }}
              />
            }
            aria-label={`File, ${props.record.title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
          >
            {isImage ? <ImageIcon /> : <FileIcon />}
            <ContextChipLabel>{props.record.title}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">Open where it was shared</TooltipPopup>
    </Tooltip>
  );
}
