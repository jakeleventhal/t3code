import { resolveNewBotHost, type NewBotHost } from "@t3tools/client-runtime/bot-turn-settings";
import { CommandId, type EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { useServerConfigs } from "../../state/entities";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../../state/environments";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { useBotActions } from "./useBotActions";

/**
 * The default host saved on the designated Assistant's environment decides, as on mobile. It only
 * places new bots; Assistant and existing bots never move.
 */
export function useNewBotHost(sourceEnvironmentId: EnvironmentId): NewBotHost {
  const defaultBotEnvironmentId = useEnvironmentSettings(
    sourceEnvironmentId,
    (settings) => settings.defaultBotEnvironmentId,
  );
  const identities = useEnvironmentIdentities();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const configs = useServerConfigs();
  return resolveNewBotHost({
    sourceEnvironmentId,
    defaultBotEnvironmentId,
    environments: identities.map((identity) => ({
      environmentId: identity.environmentId,
      label: identity.label,
      connected: connectedEnvironmentIds.includes(identity.environmentId),
      supportsBots:
        configs.get(identity.environmentId)?.environment.capabilities.botConversations === true,
    })),
  });
}

/**
 * Only a name: a bot starts with its host's bot defaults, which its profile can override.
 */
export function NewBotDialog({
  environmentId,
  open,
  onOpenChange,
  onCreated,
}: {
  environmentId: EnvironmentId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { createSpecialist } = useBotActions();
  const host = useNewBotHost(environmentId);
  const multipleEnvironments = useEnvironmentIdentities().length > 1;
  const canCreateOnHost = useAtomValue(botEnvironment.create.permissionAtom(host.environmentId));
  const unavailableReason =
    host.kind === "unavailable"
      ? `${host.reason} New bots go to the default host in Settings → Bots, never anywhere else.`
      : canCreateOnHost
        ? null
        : `This connection can’t create bots on ${host.label}.`;
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // One id per dialog session, so retrying after a lost response cannot create a second bot.
  const [commandId, setCommandId] = useState(() => CommandId.make(randomUUID()));
  const trimmedName = name.trim();

  const reset = () => {
    setName("");
    setCommandId(CommandId.make(randomUUID()));
  };
  const submit = async () => {
    if (trimmedName.length === 0 || submitting || unavailableReason !== null) return;
    setSubmitting(true);
    const created = await createSpecialist({
      environmentId: host.environmentId,
      name: trimmedName,
      commandId,
    });
    setSubmitting(false);
    if (!created) return;
    reset();
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>New bot</DialogTitle>
          <DialogDescription>
            {host.environmentId !== environmentId
              ? `Hosted on ${host.label}, your default host for new bots. Its conversations stay there, separate from Assistant’s and your other bots’.`
              : multipleEnvironments
                ? `Hosted on ${host.label}, with your Assistant. Its conversations stay there, separate from Assistant’s and your other bots’.`
                : "A bot keeps its own conversations, separate from Assistant’s and your other bots’."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input
              autoFocus
              aria-label="Bot name"
              placeholder="Fitness, Finance, Testing…"
              maxLength={200}
              value={name}
              disabled={submitting}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </label>
          {unavailableReason !== null ? (
            <p role="status" className="mt-3 text-xs text-warning-foreground">
              {unavailableReason}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={trimmedName.length === 0 || submitting || unavailableReason !== null}
            onClick={() => void submit()}
          >
            {submitting ? "Creating…" : "Create bot"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
