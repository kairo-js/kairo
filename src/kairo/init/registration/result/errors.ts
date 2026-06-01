export class RegistrationResultSenderError extends Error {
    public readonly reason: RegistrationResultSenderErrorReason;
    public readonly cause?: Error;

    constructor(reason: RegistrationResultSenderErrorReason, options: { cause?: Error }) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "RegistrationResultSenderError";
        this.reason = reason;
    }
}

export enum RegistrationResultSenderErrorReason {
    StringifyFailed = "StringifyFailed",
}

const DEFAULT_MESSAGES: Record<RegistrationResultSenderErrorReason, string> = {
    [RegistrationResultSenderErrorReason.StringifyFailed]:
        "Failed to stringify registration result.",
};
