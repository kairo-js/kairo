export class DiscoveryResponseError extends Error {
    public readonly reason: DiscoveryResponseErrorReason;
    public readonly cause?: Error;

    constructor(reason: DiscoveryResponseErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });
        this.name = "DiscoveryResponseError";
        this.reason = reason;
    }
}

export enum DiscoveryResponseErrorReason {
    Timeout = "Timeout",
    FutureTimestamp = "FutureTimestamp",
}

const DEFAULT_MESSAGES: Record<DiscoveryResponseErrorReason, string> = {
    [DiscoveryResponseErrorReason.Timeout]: "DiscoveryResponse has timed out.",
    [DiscoveryResponseErrorReason.FutureTimestamp]: "DiscoveryResponse timestamp is in the future.",
};
