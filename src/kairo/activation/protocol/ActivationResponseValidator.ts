import { validateTimestamp } from "@kairo-js/utils";
import { ActivationResponseError, ActivationResponseErrorReason } from "./response/errors";
import type { ActivationResponse } from "./response/schema";

export class ActivationResponseValidator {
    private readonly TIMEOUT_TICKS = 10;

    validateRequest(response: ActivationResponse, currentTick: number): void {
        this.validateTimestamp(response, currentTick);
    }

    private validateTimestamp(response: ActivationResponse, currentTick: number): void {
        validateTimestamp(
            currentTick,
            response.timestamp,
            this.TIMEOUT_TICKS,
            () => new ActivationResponseError(ActivationResponseErrorReason.Timeout),
            () => new ActivationResponseError(ActivationResponseErrorReason.FutureTimestamp),
        );
    }
}
