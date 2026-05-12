import type { KairoRegistry } from "@kairo-js/router";
import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import type { KairoRegistryIndex } from "../../KairoRegistryIndex";
import type { KairoRegistryRejectReason, KairoRegistryVerifier } from "../KairoRegistryVerifier";
import { AddonRegistrationManager } from "./AddonRegistrationManager";
import { RegistrationRequestBroadcaster } from "./RegistrationRequestBroadcaster";

export class RegistrationController {
    private readonly registrationRequestBroadcaster: RegistrationRequestBroadcaster;
    private readonly registrationManager: AddonRegistrationManager;
    constructor(
        private readonly kairoRegistryIndex: KairoRegistryIndex,
        private readonly kairoRegistryVerifier: KairoRegistryVerifier,
    ) {
        this.registrationRequestBroadcaster = new RegistrationRequestBroadcaster();
        this.registrationManager = new AddonRegistrationManager();
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
        const kairoRegistry = this.registrationManager.resolveKairoRegistry(
            message,
            deps.runtime.currentTick(),
        );

        const result = this.kairoRegistryVerifier.verify(kairoRegistry);
        if (!result.success) {
            this.sendRejectResult(kairoRegistry, result.reason);
            return;
        }

        this.kairoRegistryIndex.add(kairoRegistry);
        this.sendSuccessResult(kairoRegistry);
    }

    private sendSuccessResult(registry: KairoRegistry): void {}
    private sendRejectResult(registry: KairoRegistry, reason: KairoRegistryRejectReason): void {}
}
