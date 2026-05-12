export class RegistrationResponseParseError extends Error {
    public readonly reason: RegistrationResponseParseErrorReason;
    public readonly cause?: Error;

    constructor(reason: RegistrationResponseParseErrorReason, options: { cause?: Error } = {}) {
        super(RESPONSE_PARSE_DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "RegistrationResponseParseError";
        this.reason = reason;
    }
}

export enum RegistrationResponseParseErrorReason {
    InvalidJSON = "InvalidJSON",
    InvalidStructure = "InvalidStructure",
}

const RESPONSE_PARSE_DEFAULT_MESSAGES: Record<RegistrationResponseParseErrorReason, string> = {
    [RegistrationResponseParseErrorReason.InvalidJSON]:
        "Failed to parse RegistrationResponse JSON.",
    [RegistrationResponseParseErrorReason.InvalidStructure]:
        "Invalid RegistrationResponse structure.",
};

export class RegistrationResponseError extends Error {
    public readonly reason: RegistrationResponseErrorReason;
    public readonly cause?: Error;

    constructor(reason: RegistrationResponseErrorReason, options: { cause?: Error } = {}) {
        super(RESPONSE_DEFAULT_MESSAGES[reason], { cause: options.cause });
        this.name = "RegistrationResponseError";
        this.reason = reason;
    }
}

export enum RegistrationResponseErrorReason {
    Timeout = "Timeout",
    FutureTimestamp = "FutureTimestamp",
}

const RESPONSE_DEFAULT_MESSAGES: Record<RegistrationResponseErrorReason, string> = {
    [RegistrationResponseErrorReason.Timeout]: "RegistrationResponse has timed out.",
    [RegistrationResponseErrorReason.FutureTimestamp]:
        "RegistrationResponse timestamp is in the future.",
};
