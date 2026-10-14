import { Columns2Icon, Rows3Icon, Settings2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Code and Guide share the same saved diff display preferences. */
export function PullRequestDiffDisplayControls({
  children,
  onWhitespaceChange,
}: {
  /** View-specific filters; absent in the guide, where every chapter keeps its files. */
  children?: ReactNode;
  onWhitespaceChange?: (checked: boolean) => void;
}) {
  const settings = useClientSettings();
  const updateSettings = useUpdateClientSettings();
  return (
    <>
      <ToggleGroup
        aria-label="Diff layout"
        variant="segmented"
        value={[settings.diffLayout]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "stacked" || next === "split") updateSettings({ diffLayout: next });
        }}
      >
        <Toggle aria-label="Unified diff view" value="stacked">
          <Rows3Icon className="size-3.5" />
          Unified
        </Toggle>
        <Toggle aria-label="Split diff view" value="split">
          <Columns2Icon className="size-3.5" />
          Split
        </Toggle>
      </ToggleGroup>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" />}
                aria-label="Diff options"
              />
            }
          >
            <Settings2Icon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Diff options</TooltipPopup>
        </Tooltip>
        <DropdownMenuContent align="end">
          {children}
          {children ? <DropdownMenuSeparator /> : null}
          <DropdownMenuCheckboxItem
            checked={settings.diffIgnoreWhitespace}
            onCheckedChange={
              onWhitespaceChange ?? ((checked) => updateSettings({ diffIgnoreWhitespace: checked }))
            }
          >
            Hide whitespace changes
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={settings.wordWrap}
            onCheckedChange={(checked) => updateSettings({ wordWrap: checked })}
          >
            Wrap lines
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
