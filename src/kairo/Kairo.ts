import { KairoRouter, router } from "@kairo-js/router";
import { SeedRandom } from "@kairo-js/utils";
import { KairoRuntime } from "../minecraft/KairoRuntime";
import { ActivationController } from "./activation/ActivationController";
import { KairoError, KairoErrorReason } from "./errors/KairoError";
import { KairoInitializer } from "./init/KairoInitializer";
import { KairoRegistryIndex } from "./KairoRegistryIndex";

class Kairo {
    private runtime?: KairoRuntime;
    private readonly registryIndex = new KairoRegistryIndex();

    private activationController?: ActivationController;

    constructor(public readonly router: KairoRouter) {}
    init(): void {
        this.runtime = new KairoRuntime();

        const initializer = new KairoInitializer(
            this.runtime,
            new SeedRandom(),
            this.registryIndex,
            this.onInitComplete,
            () => {},
        );
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });
    }

    private readonly onInitComplete = () => {
        console.log("Kairo initialization complete.");
        (async (): Promise<void> => {
            if (!this.runtime) {
                throw new KairoError(KairoErrorReason.RuntimeNotInitialized);
            }

            this.activationController = new ActivationController(this.runtime, this.registryIndex);
            this.activationController.setup();

            await this.activationController.startupActivate();
        })();
    };
}
export const kairo = new Kairo(router);
