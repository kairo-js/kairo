export class DiscoveryResponseParseError extends Error {
    public readonly reason: DiscoveryResponseParseErrorReason;
    public readonly cause?: Error;

    constructor(reason: DiscoveryResponseParseErrorReason, options: { cause?: Error } = {}) {
        super(RESPONSE_PARSE_DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "DiscoveryResponseParseError";
        this.reason = reason;
    }
}

export enum DiscoveryResponseParseErrorReason {
    InvalidJSON = "InvalidJSON",
    InvalidStructure = "InvalidStructure",
}

const RESPONSE_PARSE_DEFAULT_MESSAGES: Record<DiscoveryResponseParseErrorReason, string> = {
    [DiscoveryResponseParseErrorReason.InvalidJSON]: "Failed to parse DiscoveryResponse JSON.",
    [DiscoveryResponseParseErrorReason.InvalidStructure]: "Invalid DiscoveryResponse structure.",
};

export class DiscoveryResponseError extends Error {
    public readonly reason: DiscoveryResponseErrorReason;
    public readonly cause?: Error;

    constructor(reason: DiscoveryResponseErrorReason, options: { cause?: Error } = {}) {
        super(RESPONSE_DEFAULT_MESSAGES[reason], { cause: options.cause });
        this.name = "DiscoveryResponseError";
        this.reason = reason;
    }
}

export enum DiscoveryResponseErrorReason {
    Timeout = "Timeout",
    FutureTimestamp = "FutureTimestamp",
}

const RESPONSE_DEFAULT_MESSAGES: Record<DiscoveryResponseErrorReason, string> = {
    [DiscoveryResponseErrorReason.Timeout]: "DiscoveryResponse has timed out.",
    [DiscoveryResponseErrorReason.FutureTimestamp]: "DiscoveryResponse timestamp is in the future.",
};
