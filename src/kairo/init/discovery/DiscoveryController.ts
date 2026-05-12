import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import { AddonDiscoveryManager } from "./AddonDiscoveryManager";
import { DiscoveryQueryBroadcaster } from "./DiscoveryQueryBroadcaster";

export class DiscoveryController {
    private readonly discoveryQueryBroadcaster: DiscoveryQueryBroadcaster;
    private readonly discoveryManager: AddonDiscoveryManager;
    constructor() {
        this.discoveryQueryBroadcaster = new DiscoveryQueryBroadcaster();
        this.discoveryManager = new AddonDiscoveryManager();
    }

    handleOnWorldLoad(registryId: string, deps: { runtime: KairoRuntime }): void {
        this.discoveryQueryBroadcaster.broadcast(registryId, deps.runtime);
    }

    handleDiscoveryResponse(
        message: string,
        deps: { runtime: KairoRuntime; pendingArray: string[] },
    ): void {
        const kairoId = this.discoveryManager.resolveKairoId(message, deps.runtime.currentTick());
        deps.pendingArray.push(kairoId);
    }
}
