import type { BotCallTargetRect } from "./botCall.logic";

/**
 * Marks the element the call is talking about. The rect must come from a real resolved target,
 * never a guess; null draws nothing. Coordinates are relative to the nearest positioned ancestor,
 * which should clip with overflow-hidden. Static by design: no pulse, nothing repaints while it shows.
 */
export function BotCallTargetOutline({
  rect,
  label,
}: {
  rect: BotCallTargetRect | null;
  label?: string | undefined;
}) {
  if (rect === null) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 rounded-md ring-2 ring-assistant ring-offset-2 ring-offset-transparent"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      {label ? (
        <span className="absolute -top-6 left-0 max-w-60 truncate rounded-md bg-assistant px-1.5 py-0.5 text-2xs font-medium text-white">
          {label}
        </span>
      ) : null}
    </div>
  );
}
