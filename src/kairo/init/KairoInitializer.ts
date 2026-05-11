import { SeedRandom, type Random } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { DiscoveryController } from "./discovery/DiscoveryController";
import { IdRegistryProvider } from "./IdRegistryProvider";
import { RegistrationController } from "./registratoin/RegistrationController";

export class KairoInitializer {
    private readonly idRegistryProvider: IdRegistryProvider;
    private readonly discoveryController: DiscoveryController;
    private readonly registrationController: RegistrationController;
    constructor(
        private readonly runtime: KairoRuntime,
        private readonly random: Random = new SeedRandom(),
    ) {
        this.idRegistryProvider = new IdRegistryProvider(this.random);
        this.discoveryController = new DiscoveryController(this.idRegistryProvider);
        this.registrationController = new RegistrationController();
    }

    setup(): void {}

    onWorldLoad(): void {
        this.discoveryController.handleOnWorldLoad({ runtime: this.runtime });
    }
}
