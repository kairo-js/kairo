export class ProvideIdRegistryError extends Error {
    public readonly reason: ProvideIdRegistryErrorReason;
    public readonly cause?: Error;
    constructor(reason: ProvideIdRegistryErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });
        this.name = "ProvideIdRegistryError";
        this.reason = reason;
    }
}

export enum ProvideIdRegistryErrorReason {
    IdGenerationFailed = "IdGenerationFailed",
}

const DEFAULT_MESSAGES: Record<ProvideIdRegistryErrorReason, string> = {
    [ProvideIdRegistryErrorReason.IdGenerationFailed]: "Failed to generate ID registry.",
};
