import type { Disposable } from "@kairo-js/router";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import type { ActivationController } from "../activation/ActivationController";
import type { KairoApiPipeline } from "../api/KairoApiPipeline";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type { CommandManifestController } from "../init/command/CommandManifestController";
import type { HandoffPendingActivation } from "./HandoffPayload";
import { HandoffEventId } from "./HandoffEventId";
import { HandoffPayloadBuilder } from "./HandoffPayloadBuilder";

const HANDOFF_DONE_TIMEOUT_TICKS = 30;

export class HandoffOrchestrator {
    constructor(
        private readonly runtime: KairoRuntime,
        private readonly apiPipeline: KairoApiPipeline,
        private readonly registryIndex: KairoRegistryQueryable,
        private readonly activationController: ActivationController,
        private readonly onComplete: () => void,
        private readonly onFailed: () => void,
        private readonly commandManifestController?: CommandManifestController,
        private readonly commandRegistrars?: ReadonlyMap<string, string>,
    ) {}

    start(
        targetKairoId: string,
        origin: "explicit" | "latest" = "explicit",
        pendingActivation?: HandoffPendingActivation,
    ): void {
        console.log(`[kairo] HandoffOrchestrator: starting handoff to ${targetKairoId}`);
        this.apiPipeline.enterSwitchingMode();

        const payload = new HandoffPayloadBuilder().build(
            this.registryIndex,
            this.activationController.world,
            this.activationController.activationOrder,
            this.commandManifestController,
            this.commandRegistrars,
            { kairoId: targetKairoId, origin },
            pendingActivation,
        );

        try {
            this.runtime.send(
                HandoffEventId.handoffStart(targetKairoId),
                JSON.stringify(payload),
            );
        } catch {
            this.apiPipeline.exitSwitchingMode();
            this.onFailed();
            return;
        }

        let done = false;
        let doneListener: Disposable;
        const timeoutHandle = this.runtime.runTimeout(() => {
            if (!done) {
                doneListener.dispose();
                this.apiPipeline.exitSwitchingMode();
                console.warn("[kairo] Handoff timed out — rolling back to active host");
                this.onFailed();
            }
        }, HANDOFF_DONE_TIMEOUT_TICKS);

        doneListener = this.runtime.receive((id) => {
            if (id !== HandoffEventId.HandoffDone) return;
            done = true;
            doneListener.dispose();
            timeoutHandle.dispose();
            console.log("[kairo] HandoffOrchestrator: handoff-done received — tearing down host infrastructure");
            this.onComplete();
        });
    }
}
