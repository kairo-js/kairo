export class DiscoveryResponseParseError extends Error {
    public readonly reason: DiscoveryResponseParseErrorReason;
    public readonly cause?: Error;

    constructor(reason: DiscoveryResponseParseErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "DiscoveryResponseParseError";
        this.reason = reason;
    }
}

export enum DiscoveryResponseParseErrorReason {
    InvalidJSON = "InvalidJSON",
    InvalidStructure = "InvalidStructure",
}

const DEFAULT_MESSAGES: Record<DiscoveryResponseParseErrorReason, string> = {
    [DiscoveryResponseParseErrorReason.InvalidJSON]: "Failed to parse DiscoveryResponse JSON.",
    [DiscoveryResponseParseErrorReason.InvalidStructure]: "Invalid DiscoveryResponse structure.",
};
