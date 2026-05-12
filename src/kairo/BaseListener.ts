import type { Disposable } from "@kairo-js/router";
import type { KairoRuntime } from "../minecraft/KairoRuntime";
import { KairoListenerError, KairoListenerErrorReason } from "./errors/KairoListenerError";

export abstract class BaseListener<TId extends string> {
    private isSetup = false;

    setup(runtime: KairoRuntime): Disposable {
        if (this.isSetup) {
            throw new KairoListenerError(KairoListenerErrorReason.AlreadySetUp);
        }

        this.isSetup = true;

        return runtime.receive(this.onEvent);
    }

    private onEvent = (id: string, message: string) => {
        if (!this.filter(id)) {
            return;
        }

        this.handle(id, message);
    };

    protected abstract filter(id: string): id is TId;
    protected abstract handle(id: TId, message: string): void;
}
