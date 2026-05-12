import { toError } from "@kairo-js/utils";
import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import { KairoInitEventId } from "../constants/KairoInitEventId";
import {
    DiscoveryQueryBroadcasterError,
    DiscoveryQueryBroadcasterErrorReason,
} from "./query/errors";
import type { DiscoveryQuery } from "./query/schema";
import { stringifyDiscoveryQuery } from "./query/stringify";

export class DiscoveryQueryBroadcaster {
    constructor() {}

    broadcast(registryId: string, runtime: KairoRuntime): void {
        const query: DiscoveryQuery = {
            registryId,
            timestamp: runtime.currentTick(),
        };

        try {
            const queryStr = stringifyDiscoveryQuery(query);

            runtime.send(KairoInitEventId.DiscoveryQuery, queryStr);
        } catch (e: unknown) {
            throw new DiscoveryQueryBroadcasterError(
                DiscoveryQueryBroadcasterErrorReason.StringifyFailed,
                { cause: toError(e) },
            );
        }
    }
}
