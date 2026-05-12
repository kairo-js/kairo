export class RegistrationResponseParseError extends Error {
    public readonly reason: RegistrationResponseParseErrorReason;
    public readonly cause?: Error;

    constructor(reason: RegistrationResponseParseErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "RegistrationResponseParseError";
        this.reason = reason;
    }
}

export enum RegistrationResponseParseErrorReason {
    InvalidJSON = "InvalidJSON",
    InvalidStructure = "InvalidStructure",
}

const DEFAULT_MESSAGES: Record<RegistrationResponseParseErrorReason, string> = {
    [RegistrationResponseParseErrorReason.InvalidJSON]:
        "Failed to parse RegistrationResponse JSON.",
    [RegistrationResponseParseErrorReason.InvalidStructure]:
        "Invalid RegistrationResponse structure.",
};
