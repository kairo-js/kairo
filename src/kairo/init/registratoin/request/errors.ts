export class RegistrationRequestBroadcasterError extends Error {
    public readonly reason: RegistrationRequestBroadcasterErrorReason;
    public readonly cause?: Error;

    constructor(reason: RegistrationRequestBroadcasterErrorReason, options: { cause?: Error }) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "RegistrationRequestBroadcasterError";
        this.reason = reason;
    }
}

export enum RegistrationRequestBroadcasterErrorReason {
    StringifyFailed = "StringifyFailed",
}

const DEFAULT_MESSAGES: Record<RegistrationRequestBroadcasterErrorReason, string> = {
    [RegistrationRequestBroadcasterErrorReason.StringifyFailed]:
        "Failed to stringify registration request.",
};
