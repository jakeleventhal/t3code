import { createFileRoute } from "@tanstack/react-router";

import { BotSettingsPanel } from "../components/settings/BotSettings";

export const Route = createFileRoute("/settings/bots")({
  component: BotSettingsPanel,
});
