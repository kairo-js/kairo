export class DiscoveryQueryBroadcasterError extends Error {
    public readonly reason: DiscoveryQueryBroadcasterErrorReason;
    public readonly cause?: Error;

    constructor(reason: DiscoveryQueryBroadcasterErrorReason, options: { cause?: Error }) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "DiscoveryQueryBroadcasterError";
        this.reason = reason;
    }
}

export enum DiscoveryQueryBroadcasterErrorReason {
    StringifyFailed = "StringifyFailed",
}

const DEFAULT_MESSAGES: Record<DiscoveryQueryBroadcasterErrorReason, string> = {
    [DiscoveryQueryBroadcasterErrorReason.StringifyFailed]: "Failed to stringify discovery query.",
};
