export class ActivationResponseParseError extends Error {
    public readonly reason: ActivationResponseParseErrorReason;
    public readonly cause?: Error;

    constructor(reason: ActivationResponseParseErrorReason, options: { cause?: Error } = {}) {
        super(RESPONSE_PARSE_DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "ActivationResponseParseError";
        this.reason = reason;
    }
}

export enum ActivationResponseParseErrorReason {
    InvalidJSON = "InvalidJSON",
    InvalidStructure = "InvalidStructure",
}

const RESPONSE_PARSE_DEFAULT_MESSAGES: Record<ActivationResponseParseErrorReason, string> = {
    [ActivationResponseParseErrorReason.InvalidJSON]: "Failed to parse ActivationResponse JSON.",
    [ActivationResponseParseErrorReason.InvalidStructure]: "Invalid ActivationResponse structure.",
};

export class ActivationResponseError extends Error {
    public readonly reason: ActivationResponseErrorReason;
    public readonly cause?: Error;

    constructor(reason: ActivationResponseErrorReason, options: { cause?: Error } = {}) {
        super(RESPONSE_DEFAULT_MESSAGES[reason], { cause: options.cause });
        this.name = "ActivationResponseError";
        this.reason = reason;
    }
}

export enum ActivationResponseErrorReason {
    Timeout = "Timeout",
    FutureTimestamp = "FutureTimestamp",
}

const RESPONSE_DEFAULT_MESSAGES: Record<ActivationResponseErrorReason, string> = {
    [ActivationResponseErrorReason.Timeout]: "ActivationResponse has timed out.",
    [ActivationResponseErrorReason.FutureTimestamp]:
        "ActivationResponse timestamp is in the future.",
};
