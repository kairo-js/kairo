import type { Disposable } from "@kairo-js/router";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { HandoffEventId } from "./HandoffEventId";
import type { HandoffPayload } from "./HandoffPayload";

export class HandoffReceiver {
    private listener?: Disposable;

    constructor(
        private readonly runtime: KairoRuntime,
        private readonly ownKairoId: string,
        private readonly onReceive: (payload: HandoffPayload) => void,
    ) {}

    setup(): void {
        const expectedId = HandoffEventId.handoffStart(this.ownKairoId);
        this.listener = this.runtime.receive((id, message) => {
            if (id !== expectedId) return;

            let payload: HandoffPayload;
            try {
                payload = JSON.parse(message) as HandoffPayload;
                if (payload.protocol !== 1) return;
            } catch {
                return;
            }

            this.listener?.dispose();
            this.listener = undefined;            try {
                this.onReceive(payload);
            } catch (e) {
                console.error("[kairo] HandoffReceiver: setup failed:", e);
                return;
            }            try {
                this.runtime.send(HandoffEventId.HandoffDone, "");
            } catch {}
        });
    }

    dispose(): void {
        this.listener?.dispose();
        this.listener = undefined;
    }
}
