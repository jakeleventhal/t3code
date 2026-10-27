const GAP_MS = 5 * 60 * 1_000;

/** Activity rows do not start a new conversation block. */
export function botMessageTimeMarkers(
  rows: ReadonlyArray<{ readonly id: string; readonly createdAt: string; readonly type: string }>,
): ReadonlySet<string> {
  const markers = new Set<string>();
  let previous: number | undefined;
  for (const row of rows) {
    if (row.type !== "message") continue;
    const at = Date.parse(row.createdAt);
    if (!Number.isFinite(at)) continue;
    if (
      previous === undefined ||
      at - previous >= GAP_MS ||
      new Date(at).toDateString() !== new Date(previous).toDateString()
    )
      markers.add(row.id);
    previous = Math.max(previous ?? at, at);
  }
  return markers;
}

export function botMessageTimeLabel(input: string, now = new Date()): string {
  const date = new Date(input);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day =
    date.toDateString() === now.toDateString()
      ? "Today"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} ${time}`;
}
