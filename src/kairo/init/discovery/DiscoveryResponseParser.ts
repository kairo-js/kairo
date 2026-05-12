import { safeJsonParse, toError } from "@kairo-js/utils";
import { DiscoveryResponseParseError, DiscoveryResponseParseErrorReason } from "./response/errors";
import type { DiscoveryResponse } from "./response/schema";
import { validateDiscoveryResponse } from "./response/vaildate";

export class DiscoveryResponseParser {
    constructor() {}

    parse(message: string): DiscoveryResponse {
        const parsed = safeJsonParse(
            message,
            () => new DiscoveryResponseParseError(DiscoveryResponseParseErrorReason.InvalidJSON),
        );

        if (!validateDiscoveryResponse(parsed)) {
            throw new DiscoveryResponseParseError(
                DiscoveryResponseParseErrorReason.InvalidStructure,
                {
                    cause: toError(validateDiscoveryResponse.errors),
                },
            );
        }

        const response: DiscoveryResponse = parsed;

        return response;
    }
}
