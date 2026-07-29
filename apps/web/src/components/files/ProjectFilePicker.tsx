import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState, type ReactNode } from "react";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { type CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { Command, CommandDialogPopup, CommandInput, CommandPanel } from "../ui/command";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "./ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "./projectFilesQueryState";

interface ProjectFilePickerProps {
  readonly setOpen: (open: boolean) => void;
}

function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
}) {
  if (!props.active) return props.value;

  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) parts.push(props.value.slice(start, index));
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {props.value[index]}
      </strong>,
    );
    start = index + 1;
  }
  if (start < props.value.length) parts.push(props.value.slice(start));

  return <span className="text-muted-foreground">{parts}</span>;
}

function ProjectFilePickerPopup(props: {
  readonly children: ReactNode;
  readonly setOpen: (open: boolean) => void;
}) {
  return (
    <CommandDialogPopup
      aria-label="File picker"
      className="max-w-3xl overflow-hidden p-0"
      data-command-palette="true"
      data-testid="project-file-picker"
      onBackdropPointerDown={() => props.setOpen(false)}
    >
      {props.children}
    </CommandDialogPopup>
  );
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

function EmptyProjectFilePicker(props: ProjectFilePickerProps) {
  return (
    <ProjectFilePickerPopup setOpen={props.setOpen}>
      <Command aria-label="File picker" mode="none" value="">
        <CommandInput disabled placeholder="Search files…" />
        <CommandPanel>
          <div className="py-10 text-center text-sm text-muted-foreground">
            Open a project to search its files.
          </div>
        </CommandPanel>
      </Command>
    </ProjectFilePickerPopup>
  );
}

function OpenProjectFilePicker(props: ProjectFilePickerProps & { target: ActiveProjectTarget }) {
  const { target } = props;
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const result = useProjectFilePickerQuery(
    target.environmentId,
    target.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
  );
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const matches = useMemo(
    () => getProjectFilePickerMatches(result.entries, result.matchedQuery),
    [result.entries, result.matchedQuery],
  );
  const hasMatchedQuery = /\S/.test(result.matchedQuery);
  const items = useMemo<CommandPaletteActionItem[]>(
    () =>
      matches.map((match) => ({
        kind: "action",
        value: `file:${match.path}`,
        searchTerms: [match.name, match.path],
        title: (
          <HighlightedFuzzyText
            active={hasMatchedQuery}
            value={match.name}
            indices={match.nameMatchIndices}
          />
        ),
        description: (
          <HighlightedFuzzyText
            active={hasMatchedQuery}
            value={match.path}
            indices={match.pathMatchIndices}
          />
        ),
        icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
        run: async () => {
          useRightPanelStore.getState().openFile(target.threadRef, match.path);
        },
      })),
    [hasMatchedQuery, matches, resolvedTheme, target.threadRef],
  );

  const emptyStateMessage = getEmptyStateMessage(query, result.error, result.isPending);

  return (
    <ProjectFilePickerPopup setOpen={props.setOpen}>
      <Command
        aria-label="File picker"
        autoHighlight="always"
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={(value) => {
          setHighlightedItemValue(null);
          setQuery(value);
        }}
        value={query}
      >
        <CommandInput placeholder="Search files…" />
        <CommandPanel className="max-h-[min(34rem,76vh)]">
          <CommandPaletteResults
            groups={
              items.length > 0 ? [{ value: "project-files", label: target.projectName, items }] : []
            }
            highlightedItemValue={highlightedItemValue}
            isActionsOnly={false}
            keybindings={keybindings}
            onExecuteItem={(item) => {
              if (item.kind !== "action") return;
              props.setOpen(false);
              void item.run();
            }}
            emptyStateMessage={emptyStateMessage}
          />
        </CommandPanel>
      </Command>
    </ProjectFilePickerPopup>
  );
}

export function ProjectFilePicker(props: ProjectFilePickerProps) {
  const target = useActiveProjectTarget();

  if (!target) {
    return <EmptyProjectFilePicker setOpen={props.setOpen} />;
  }

  return <OpenProjectFilePicker setOpen={props.setOpen} target={target} />;
}
