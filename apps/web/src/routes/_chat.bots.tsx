import { createFileRoute } from "@tanstack/react-router";

import { BotsHome } from "../components/bots/BotsHome";

export const Route = createFileRoute("/_chat/bots")({
  component: BotsHome,
});
