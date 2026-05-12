import { validateTimestamp } from "@kairo-js/utils";
import { DiscoveryResponseError, DiscoveryResponseErrorReason } from "./response/errors";
import type { DiscoveryResponse } from "./response/schema";

export class DiscoveryResponseValidator {
    private readonly TIMEOUT_TICKS = 10;

    validateRequest(response: DiscoveryResponse, currentTick: number): void {
        this.validateTimestamp(response, currentTick);
    }

    private validateTimestamp(response: DiscoveryResponse, currentTick: number): void {
        validateTimestamp(
            currentTick,
            response.timestamp,
            this.TIMEOUT_TICKS,
            () => new DiscoveryResponseError(DiscoveryResponseErrorReason.Timeout),
            () => new DiscoveryResponseError(DiscoveryResponseErrorReason.FutureTimestamp),
        );
    }
}
