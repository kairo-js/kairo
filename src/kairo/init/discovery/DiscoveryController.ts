import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import type { IdRegistryProvider } from "../IdRegistryProvider";
import { DiscoveryQueryBroadcaster } from "./DiscoveryQueryBroadcaster";

export class DiscoveryController {
    private readonly discoveryQueryBroadcaster: DiscoveryQueryBroadcaster;
    constructor(private readonly idRegistryProvider: IdRegistryProvider) {
        this.discoveryQueryBroadcaster = new DiscoveryQueryBroadcaster();
    }

    handleOnWorldLoad(deps: { runtime: KairoRuntime }): void {
        const registryId = this.idRegistryProvider.provideRegistry(deps.runtime);
        this.discoveryQueryBroadcaster.broadcast(deps.runtime, registryId);
    }
}
