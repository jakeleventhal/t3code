import { botDefaultVoice } from "@t3tools/shared/botPreferences";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  type ScopedThreadRef,
  type ServerSettings,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { deriveLogicalProjectKeyFromSettings } from "../../logicalProject";
import { useEnvironmentSupportsVoiceSettings, useVoiceCatalog } from "../../state/botVoice";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useVoiceCall } from "../../voice/useVoiceCall";
import {
  describeVoiceSelection,
  resolveBotVoice,
  voiceOptionGroups,
} from "../settings/voiceSettings.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotCallStartButton } from "./BotCallStartButton";
import type { BotCallAvailability } from "./botCall.logic";
import { startBotCall } from "./botCallActions";
import { isBotProject } from "./botRoom.logic";
import { useBotRoomStore } from "./botRoomStore";
import { useBotCallAvailability } from "./useBotCallAvailability";
import { VoiceSelectionPicker } from "./VoiceSelectionPicker";

const NOT_STARTED: BotCallAvailability = {
  kind: "unavailable",
  reason: "Send a message first to start this conversation, then call.",
};

/**
 * The bot header's call control: Call for the conversation on screen, and a chevron into the
 * bot's voice. The chevron edits the same environment and project settings as Settings > Voice,
 * and a change applies from the next call; the live one keeps its voice.
 */
export function BotCallControl({
  project,
  threadRef,
}: {
  project: EnvironmentProject;
  /** Null for a conversation that hasn't been created yet. */
  threadRef: ScopedThreadRef | null;
}) {
  return isBotProject(project) ? (
    <BotCallControlButtons project={project} threadRef={threadRef} />
  ) : null;
}

function BotCallControlButtons({
  project,
  threadRef: routeThreadRef,
}: {
  project: EnvironmentProject;
  threadRef: ScopedThreadRef | null;
}) {
  const supported = useEnvironmentSupportsVoiceSettings(project.environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(project.environmentId));
  const routeAvailability = useBotCallAvailability(project.environmentId, project.id);
  const call = useVoiceCall();
  if (!supported || settings === null) return null;
  // A call runs on the environment of the conversation it was placed from, never another.
  const threadRef = routeThreadRef?.environmentId === project.environmentId ? routeThreadRef : null;
  const availability = threadRef === null ? NOT_STARTED : routeAvailability;
  const bot = { id: project.id, title: project.title, botRole: project.botRole ?? null };
  const onThisCall =
    call !== null &&
    call.phase !== "failed" &&
    call.environmentId === project.environmentId &&
    call.bot.id === project.id;
  return (
    <div className="flex shrink-0 items-center">
      <BotCallStartButton
        prominent
        environmentId={project.environmentId}
        bot={bot}
        threadId={threadRef?.threadId ?? null}
        active={call}
        availability={availability}
        onStart={({ replacingCallId }) => {
          if (threadRef === null) return;
          void startBotCall(
            { environmentId: project.environmentId, bot, threadRef },
            replacingCallId,
          );
        }}
        onOpenActive={() => {
          if (call !== null) useBotRoomStore.getState().setCallTranscriptOpenFor(call.callId);
        }}
      />
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Voice for ${project.title}`}
                  />
                }
              />
            }
          >
            <ChevronDownIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Voice for {project.title}</TooltipPopup>
        </Tooltip>
        <PopoverPopup align="end" width="md" padding="compact">
          <BotVoicePopoverContent
            project={project}
            settings={settings}
            availability={availability}
            onCall={onThisCall}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

// Mounted only while open, so the catalog is fetched when someone looks.
function BotVoicePopoverContent({
  project,
  settings,
  availability,
  onCall,
}: {
  project: EnvironmentProject;
  settings: ServerSettings;
  availability: BotCallAvailability;
  /** This bot is on the live call, which keeps the voice it started with. */
  onCall: boolean;
}) {
  const navigate = useNavigate();
  const groupingMode = useClientSettings((client) => client.sidebarProjectGroupingMode);
  const groupingOverrides = useClientSettings((client) => client.sidebarProjectGroupingOverrides);
  const canWrite = useEnvironmentScope(project.environmentId, AuthSettingsWriteScope);
  const { catalog } = useVoiceCatalog(project.environmentId, settings.voiceConnections);
  const configure = useAtomCommand(botEnvironment.configure);
  const [target, setTarget] = useState<"bot" | "default">("bot");
  const voice = resolveBotVoice(settings, project.id);
  const defaultVoice = describeVoiceSelection(botDefaultVoice(settings), catalog);
  const shown = target === "bot" ? voice.selection : botDefaultVoice(settings);
  const described = describeVoiceSelection(shown, catalog);
  const hasVoices = voiceOptionGroups(catalog).length > 0;

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">Voice</h3>
        <ToggleGroup
          aria-label="Applies to"
          value={[target]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "bot" || value === "default") setTarget(value);
          }}
        >
          <Toggle value="bot">{project.title}</Toggle>
          <Toggle value="default">All bots</Toggle>
        </ToggleGroup>
      </div>
      <p className="text-xs text-muted-foreground">
        {target === "default"
          ? "Changes the default. Bots with their own voice keep it."
          : voice.kind === "own"
            ? `${project.title} has its own voice. The default is ${defaultVoice.label}.`
            : `${project.title} uses the default. Picking a voice here gives it its own.`}
      </p>
      <VoiceSelectionPicker
        environmentId={project.environmentId}
        catalog={catalog}
        selection={shown}
        disabled={!canWrite}
        ariaLabel={target === "bot" ? `${project.title} voice` : "Default bot voice"}
        {...(target === "bot"
          ? {
              inherit: {
                label: `Use default · ${defaultVoice.label}`,
                active: voice.kind === "default",
              },
            }
          : {})}
        onChange={(change) =>
          void configure({
            environmentId: project.environmentId,
            input:
              target === "default"
                ? {
                    defaultVoiceSelection:
                      change.kind === "set" ? change.selection : botDefaultVoice(settings),
                  }
                : {
                    voiceOverride: {
                      projectId: project.id,
                      selection: change.kind === "inherit" ? "inherit" : change.selection,
                    },
                  },
          })
        }
      />
      {described.detail ? (
        <p
          className={
            described.issue ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"
          }
        >
          {described.detail}
        </p>
      ) : null}
      {availability.kind === "unavailable" ? (
        <p
          className={
            availability.setup ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"
          }
        >
          {availability.reason}
        </p>
      ) : onCall ? (
        <p className="text-xs text-muted-foreground">
          Changes apply to your next call. This call keeps its voice.
        </p>
      ) : null}
      {!canWrite || (!hasVoices && catalog !== null) ? (
        <p className="text-xs text-muted-foreground">
          {!canWrite
            ? "This connection can't change settings here."
            : "Add a voice account in Voice settings to choose a voice."}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void navigate({
              to: "/settings/voice",
              search: {
                machine: project.environmentId,
                project: deriveLogicalProjectKeyFromSettings(project, {
                  sidebarProjectGroupingMode: groupingMode,
                  sidebarProjectGroupingOverrides: groupingOverrides,
                }),
              },
            })
          }
        >
          <SettingsIcon />
          Voice settings
        </Button>
      </div>
    </div>
  );
}
