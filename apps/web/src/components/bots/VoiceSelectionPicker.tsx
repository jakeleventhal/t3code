import type { VoiceCatalog, VoiceSelection } from "@t3tools/contracts";

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
  catalog,
  selection,
  inherit,
  disabled = false,
  ariaLabel,
  className,
  onChange,
}: {
  catalog: VoiceCatalog | null;
  selection: VoiceSelection | null;
  /** Offers following the default; `active` means the value shown is inherited. */
  inherit?: { readonly label: string; readonly active: boolean } | undefined;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  onChange: (change: VoicePickerChange) => void;
}) {
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
            {group.voices.map((voice) => (
              <SelectItem key={voice.key} hideIndicator value={voice.key}>
                {voice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectPopup>
    </Select>
  );
}
