export class ActivationRequestSenderError extends Error {
    public readonly reason: ActivationRequestSenderErrorReason;
    public readonly cause?: Error;

    constructor(reason: ActivationRequestSenderErrorReason, options: { cause?: Error }) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "ActivationRequestSenderError";
        this.reason = reason;
    }
}

export enum ActivationRequestSenderErrorReason {
    StringifyFailed = "StringifyFailed",
}

const DEFAULT_MESSAGES: Record<ActivationRequestSenderErrorReason, string> = {
    [ActivationRequestSenderErrorReason.StringifyFailed]: "Failed to stringify activation request.",
};
