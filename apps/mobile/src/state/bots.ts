import { createBotEnvironmentAtoms } from "@t3tools/client-runtime/state/bots";

import { connectionAtomRuntime } from "../connection/runtime";

export const botEnvironment = createBotEnvironmentAtoms(connectionAtomRuntime);
