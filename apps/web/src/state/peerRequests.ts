import { createPeerRequestAtoms } from "@t3tools/client-runtime/state/peer-requests";

import { connectionAtomRuntime } from "../connection/runtime";

export const peerRequests = createPeerRequestAtoms(connectionAtomRuntime);
