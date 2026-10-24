import { CommandId, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { randomUUID } from "../../lib/utils";
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
 * Only a name for now: a bot starts with the environment's default model, which its main
 * conversation can change like any thread.
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
    if (trimmedName.length === 0 || submitting) return;
    setSubmitting(true);
    const created = await createSpecialist({ environmentId, name: trimmedName, commandId });
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
            A bot keeps its own conversations on this environment, separate from Assistant’s and
            your other bots’.
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
          <Button disabled={trimmedName.length === 0 || submitting} onClick={() => void submit()}>
            {submitting ? "Creating…" : "Create bot"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
