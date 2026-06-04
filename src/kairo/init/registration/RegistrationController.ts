import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import type { KairoRegistryIndex } from "../../KairoRegistryIndex";
import type { KairoRegistryRejectReason, KairoRegistryVerifier } from "../KairoRegistryVerifier";
import { AddonRegistrationManager } from "./AddonRegistrationManager";
import { RegistrationRequestBroadcaster } from "./RegistrationRequestBroadcaster";
import { RegistrationResultSender } from "./RegistrationResultSender";

export class RegistrationController {
    private readonly registrationRequestBroadcaster: RegistrationRequestBroadcaster;
    private readonly registrationManager: AddonRegistrationManager;
    private readonly registrationResultSender: RegistrationResultSender;
    constructor(
        private readonly kairoRegistryIndex: KairoRegistryIndex,
        private readonly kairoRegistryVerifier: KairoRegistryVerifier,
    ) {
        this.registrationRequestBroadcaster = new RegistrationRequestBroadcaster();
        this.registrationManager = new AddonRegistrationManager();
        this.registrationResultSender = new RegistrationResultSender();
    }

    handleDiscoveryComplete(
        approvals: readonly string[],
        rejects: readonly string[],
        deps: { runtime: KairoRuntime },
    ): void {
        this.registrationRequestBroadcaster.broadcast(
            approvals as string[],
            rejects as string[],
            deps.runtime,
        );
    }

    handleRegistrationResponse(message: string, deps: { runtime: KairoRuntime }): void {
        const kairoRegistry =
            this.registrationManager.resolveRegistration(message, deps.runtime.currentTick());

        const result = this.kairoRegistryVerifier.verify(kairoRegistry);
        if (!result.success) {
            this.sendResult(kairoRegistry.kairoId, { success: false, reason: result.reason }, deps);
            return;
        }

        this.kairoRegistryIndex.add(kairoRegistry);
        this.sendResult(kairoRegistry.kairoId, { success: true }, deps);
    }

    private sendResult(
        kairoId: string,
        result: { success: boolean; reason?: KairoRegistryRejectReason },
        deps: { runtime: KairoRuntime },
    ): void {
        this.registrationResultSender.send(kairoId, result, deps.runtime);
    }
}
