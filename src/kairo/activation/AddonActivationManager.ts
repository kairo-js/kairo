import { ActivationResponseParser } from "./ActivationResponseParser";
import { ActivationResponseValidator } from "./ActivationValidator";
import type { ActivationResult } from "./result/schema";

export class AddonActivationManager {
    private readonly parser = new ActivationResponseParser();
    private readonly validator = new ActivationResponseValidator();
    constructor() {}

    resolveActivationResult(message: string, currentTick: number): ActivationResult {
        const response = this.parser.parse(message);
        this.validator.validateRequest(response, currentTick);
        return {
            kairoId: response.kairoId,
            status: response.status,
            action: response.action,
            reason: response.reason,
        };
    }
}
