export class KairoInitError extends Error {
    public readonly reason: KairoInitErrorReason;
    public readonly cause?: Error;

    constructor(reason: KairoInitErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });

        this.name = "KairoInitError";
        this.reason = reason;
    }
}

export enum KairoInitErrorReason {
    NotInitialized = "NotInitialized",
    AlreadyInitialized = "AlreadyInitialized",
    AlreadyDisposed = "AlreadyDisposed",
    InvalidPhase = "InvalidPhase",
}

const DEFAULT_MESSAGES: Record<KairoInitErrorReason, string> = {
    [KairoInitErrorReason.NotInitialized]: "Kairo is not initialized. Call init() first.",
    [KairoInitErrorReason.AlreadyInitialized]: "Kairo has already been initialized.",
    [KairoInitErrorReason.AlreadyDisposed]: "Initializer is already disposed.",
    [KairoInitErrorReason.InvalidPhase]: "Invalid phase for the requested operation.",
};
