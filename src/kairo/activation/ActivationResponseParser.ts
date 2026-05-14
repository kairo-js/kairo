import { safeJsonParse, toError } from "@kairo-js/utils";
import {
    ActivationResponseParseError,
    ActivationResponseParseErrorReason,
} from "./response/errors";
import type { ActivationResponse } from "./response/schema";
import { validateActivationResponse } from "./response/validate";

export class ActivationResponseParser {
    constructor() {}

    parse(message: string): ActivationResponse {
        const parsed = safeJsonParse(
            message,
            () => new ActivationResponseParseError(ActivationResponseParseErrorReason.InvalidJSON),
        );

        if (!validateActivationResponse(parsed)) {
            throw new ActivationResponseParseError(
                ActivationResponseParseErrorReason.InvalidStructure,
                {
                    cause: toError(validateActivationResponse.errors),
                },
            );
        }

        const response: ActivationResponse = parsed;

        return response;
    }
}
