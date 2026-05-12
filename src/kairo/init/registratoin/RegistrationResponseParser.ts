import { safeJsonParse, toError } from "@kairo-js/utils";
import {
    RegistrationResponseParseError,
    RegistrationResponseParseErrorReason,
} from "./response/errors";
import type { RegistrationResponse } from "./response/schema";
import { validateRegistrationResponse } from "./response/validate";

export class RegistrationResponseParser {
    constructor() {}

    parse(message: string): RegistrationResponse {
        const parsed = safeJsonParse(
            message,
            () =>
                new RegistrationResponseParseError(
                    RegistrationResponseParseErrorReason.InvalidJSON,
                ),
        );

        if (!validateRegistrationResponse(parsed)) {
            throw new RegistrationResponseParseError(
                RegistrationResponseParseErrorReason.InvalidStructure,
                {
                    cause: toError(validateRegistrationResponse.errors),
                },
            );
        }

        const response: RegistrationResponse = parsed;

        return response;
    }
}
