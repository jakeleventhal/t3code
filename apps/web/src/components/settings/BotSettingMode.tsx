import type { ReactNode } from "react";
import { Button } from "../ui/button";

export function BotSettingMode({
  label,
  custom,
  disabled,
  onDefault,
  onCustom,
  children,
}: {
  label: string;
  custom: boolean;
  disabled: boolean;
  onDefault: () => void;
  onCustom: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div role="group" aria-label={`${label} source`} className="flex items-center gap-1">
        <Button
          size="xs"
          variant={custom ? "ghost-muted" : "secondary"}
          aria-pressed={!custom}
          disabled={disabled}
          onClick={onDefault}
        >
          Default
        </Button>
        <Button
          size="xs"
          variant={custom ? "secondary" : "ghost-muted"}
          aria-pressed={custom}
          disabled={disabled}
          onClick={onCustom}
        >
          Custom
        </Button>
      </div>
      <div className={custom ? undefined : "opacity-60"}>{children}</div>
    </div>
  );
}
