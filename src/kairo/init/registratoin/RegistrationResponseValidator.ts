import { validateTimestamp } from "@kairo-js/utils";
import { RegistrationResponseError, RegistrationResponseErrorReason } from "./errors";
import type { RegistrationResponse } from "./response/schema";

export class RegistrationResponseValidator {
    private readonly TIMEOUT_TICKS = 10;

    validateRequest(response: RegistrationResponse, currentTick: number): void {
        this.validateTimestamp(response, currentTick);
    }

    private validateTimestamp(response: RegistrationResponse, currentTick: number): void {
        validateTimestamp(
            currentTick,
            response.timestamp,
            this.TIMEOUT_TICKS,
            () => new RegistrationResponseError(RegistrationResponseErrorReason.Timeout),
            () => new RegistrationResponseError(RegistrationResponseErrorReason.FutureTimestamp),
        );
    }
}
