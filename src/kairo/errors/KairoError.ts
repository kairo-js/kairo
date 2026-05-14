export class KairoError extends Error {
    public readonly reason: KairoErrorReason;
    public readonly cause?: Error;

    constructor(reason: KairoErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "KairoError";
        this.reason = reason;
    }
}

export enum KairoErrorReason {
    RuntimeNotInitialized = "RuntimeNotInitialized",
}

const DEFAULT_MESSAGES: Record<KairoErrorReason, string> = {
    [KairoErrorReason.RuntimeNotInitialized]: "KairoRuntime is not initialized.",
};
