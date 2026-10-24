import {
  ProjectMonogramText,
  type BotFile,
  type BotFilesPage,
  type ProjectIconColor,
  type ProjectIconOverride,
  type ScheduledTaskSchedule,
} from "@t3tools/contracts";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";

const DAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

function joinWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function formatTimeOfDay(timeOfDay: string, locale: string | undefined): string {
  const [hours = 0, minutes = 0] = timeOfDay.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInterval(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes < 1) return "Every few seconds";
  if (minutes === 1) return "Every minute";
  if (minutes < 60 || minutes % 60 !== 0) return `Every ${minutes} minutes`;
  const hours = minutes / 60;
  if (hours === 1) return "Every hour";
  if (hours < 24 || hours % 24 !== 0) return `Every ${hours} hours`;
  const days = hours / 24;
  return days === 1 ? "Every day" : `Every ${days} days`;
}

/** A schedule as a person would say it, without the 24-hour clock routines are stored in. */
export function botRoutineScheduleLabel(schedule: ScheduledTaskSchedule, locale?: string): string {
  if (schedule.type === "webhook") return "When something outside T3 Code asks";
  if (schedule.type === "interval") return formatInterval(schedule.everyMs);
  const time = formatTimeOfDay(schedule.timeOfDay, locale);
  const days = [...new Set(schedule.weekdays ?? [])].sort((left, right) => left - right);
  if (days.length === 0 || days.length === 7) return `Every day at ${time}`;
  if (days.length === 5 && days.every((day) => day >= 1 && day <= 5)) {
    return `Every weekday at ${time}`;
  }
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return `Weekends at ${time}`;
  return `${joinWords(days.map((day) => DAY_NAMES[day] ?? ""))} at ${time}`;
}

export type BotFileGroupLabel = "Today" | "This week" | "Older";

export interface BotFileGroup {
  readonly label: BotFileGroupLabel;
  readonly files: ReadonlyArray<BotFile>;
}

/** Groups newest-first files by the viewer's calendar: today, the six days before, then older. */
export function groupBotFiles(
  files: ReadonlyArray<BotFile>,
  nowMs: number,
): ReadonlyArray<BotFileGroup> {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const groups: Record<BotFileGroupLabel, BotFile[]> = { Today: [], "This week": [], Older: [] };
  for (const file of files) {
    const createdAt = Date.parse(file.createdAt);
    const label: BotFileGroupLabel =
      createdAt >= startOfToday ? "Today" : createdAt >= startOfWeek ? "This week" : "Older";
    groups[label].push(file);
  }
  return (["Today", "This week", "Older"] as const).flatMap((label) =>
    groups[label].length === 0 ? [] : [{ label, files: groups[label] }],
  );
}

/**
 * Pages are fetched by cursor, so a file shared while the list is open can appear on two pages.
 * The last page decides whether there is more; a page can be empty yet still carry a cursor.
 */
export function mergeBotFilePages(pages: ReadonlyArray<BotFilesPage>): {
  readonly files: ReadonlyArray<BotFile>;
  readonly nextCursor: BotFilesPage["nextCursor"];
} {
  const seen = new Set<string>();
  const files = pages.flatMap((page) =>
    page.items.filter((file) => {
      if (seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    }),
  );
  return { files, nextCursor: pages.at(-1)?.nextCursor ?? null };
}

export type BotFileVisual = "image" | "document" | "table" | "page" | "audio" | "video" | "file";

export interface BotFilePreviewTarget {
  readonly attachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly htmlRender: boolean;
}

/** What the existing attachment preview needs to show a file, whichever way it was shared. */
export function botFilePreviewTarget(file: BotFile): BotFilePreviewTarget {
  if (file.kind === "html") {
    return {
      attachmentId: file.htmlRender.attachmentId,
      name: htmlRenderFileName(file.htmlRender.title),
      mimeType: "text/html",
      sizeBytes: 0,
      htmlRender: true,
    };
  }
  return {
    attachmentId: file.attachment.id,
    name: file.attachment.name,
    mimeType: file.attachment.mimeType,
    sizeBytes: file.attachment.sizeBytes,
    htmlRender: false,
  };
}

export function botFileVisual(file: BotFile): BotFileVisual {
  if (file.kind === "html") return "page";
  if (file.attachment.type === "image") return "image";
  const kind = filePreviewKind(file.attachment);
  if (kind === "image") return "image";
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  if (kind === "html") return "page";
  if (/\.(csv|tsv|xlsx?|numbers)$/i.test(file.attachment.name)) return "table";
  if (kind === "pdf" || kind === "markdown" || kind === "text") return "document";
  return "file";
}

export function botFileTitle(file: BotFile): string {
  const title = file.title.trim();
  if (title.length > 0) return title;
  return file.kind === "html" ? file.htmlRender.title : file.attachment.name;
}

const isMonogramText = Schema.is(ProjectMonogramText);

/** One or two letters for a bot's initials avatar, or null when its name has no letter to use. */
export function botInitials(title: string): string | null {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const initials = (
    words.length === 1
      ? Array.from(words[0]!).slice(0, 2).join("")
      : words
          .slice(0, 2)
          .map((word) => Array.from(word)[0] ?? "")
          .join("")
  ).toUpperCase();
  return isMonogramText(initials) ? initials : null;
}

export function botInitialsIcon(
  title: string,
  color: ProjectIconColor,
): ProjectIconOverride | null {
  const text = botInitials(title);
  return text === null ? null : { kind: "monogram", text, color };
}
