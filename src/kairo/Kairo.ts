import { KairoRouter, router } from "@kairo-js/router";
import { SeedRandom } from "@kairo-js/utils";
import { KairoRuntime } from "../minecraft/KairoRuntime";
import { KairoInitializer } from "./init/KairoInitializer";
import { KairoRegistryIndex } from "./KairoRegistryIndex";

class Kairo {
    private runtime?: KairoRuntime;
    private readonly registryIndex = new KairoRegistryIndex();
    constructor(public readonly router: KairoRouter) {}
    init(): void {
        this.runtime = new KairoRuntime();

        const initializer = new KairoInitializer(
            this.runtime,
            new SeedRandom(),
            this.registryIndex,
        );
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });
    }
}
export const kairo = new Kairo(router);
