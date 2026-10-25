import { PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useVoicePreview } from "../../voice/useVoicePreview";
import type { EnvironmentId, VoiceCatalog, VoiceSelection } from "@t3tools/contracts";

import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  describeVoiceSelection,
  parseVoiceSelectionKey,
  voiceOptionGroups,
  voiceSelectionKey,
} from "../settings/voiceSettings.logic";

const INHERIT_VALUE = "inherit";
const NONE_VALUE = "none";

export type VoicePickerChange =
  | { readonly kind: "inherit" }
  | { readonly kind: "set"; readonly selection: VoiceSelection | null };

/**
 * One list for every saved voice account, grouped by account and model, so the
 * account (and who bills for it) is visible right where the voice is chosen.
 */
export function VoiceSelectionPicker({
  environmentId,
  catalog,
  selection,
  inherit,
  disabled = false,
  ariaLabel,
  className,
  onChange,
}: {
  environmentId: EnvironmentId;
  catalog: VoiceCatalog | null;
  selection: VoiceSelection | null;
  /** Offers following the default; `active` means the value shown is inherited. */
  inherit?: { readonly label: string; readonly active: boolean } | undefined;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  onChange: (change: VoicePickerChange) => void;
}) {
  const preview = useVoicePreview(environmentId);
  const groups = voiceOptionGroups(catalog);
  const value = inherit?.active
    ? INHERIT_VALUE
    : selection === null
      ? NONE_VALUE
      : voiceSelectionKey(selection);
  const current = describeVoiceSelection(selection, catalog);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === INHERIT_VALUE) return onChange({ kind: "inherit" });
        if (next === NONE_VALUE) return onChange({ kind: "set", selection: null });
        const parsed = typeof next === "string" ? parseVoiceSelectionKey(next) : null;
        if (parsed) onChange({ kind: "set", selection: parsed });
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label={ariaLabel}>
        <SelectValue>
          {() =>
            inherit?.active
              ? inherit.label
              : current.issue
                ? `${current.label} (unavailable)`
                : current.label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {preview.error ? (
          <p role="alert" className="max-w-72 whitespace-normal p-2 text-sm text-destructive">
            {preview.error}
          </p>
        ) : null}
        {inherit ? (
          <SelectItem hideIndicator value={INHERIT_VALUE}>
            {inherit.label}
          </SelectItem>
        ) : null}
        <SelectItem hideIndicator value={NONE_VALUE}>
          No voice
        </SelectItem>
        {groups.map((group) => (
          <SelectGroup key={group.key}>
            <SelectGroupLabel>{group.label}</SelectGroupLabel>
            {group.voices.map((voice) => {
              const selected = parseVoiceSelectionKey(voice.key);
              const connection = catalog?.connections.find(
                (entry) => entry.id === selected?.connectionId,
              );
              const playing = preview.playing === JSON.stringify(selected);
              return (
                <div key={voice.key} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SelectItem hideIndicator value={voice.key}>
                      {voice.label}
                    </SelectItem>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${playing ? "Stop" : "Preview"} ${voice.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selected && connection) void preview.play(selected, connection.kind);
                    }}
                  >
                    {playing ? <SquareIcon /> : <PlayIcon />}
                  </Button>
                </div>
              );
            })}
          </SelectGroup>
        ))}
      </SelectPopup>
    </Select>
  );
}
