export class KairoListenerError extends Error {
    public readonly reason: KairoListenerErrorReason;
    public readonly cause?: Error;

    constructor(reason: KairoListenerErrorReason, options: { cause?: Error } = {}) {
        super(DEFAULT_MESSAGES[reason], { cause: options.cause });
        this.name = "KairoListenerError";
        this.reason = reason;
    }
}

export enum KairoListenerErrorReason {
    AlreadySetUp = "AlreadySetUp",
}

const DEFAULT_MESSAGES: Record<KairoListenerErrorReason, string> = {
    [KairoListenerErrorReason.AlreadySetUp]: "Listener is already set up.",
};
