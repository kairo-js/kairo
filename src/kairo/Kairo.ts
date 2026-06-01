import { KairoRouter, router } from "@kairo-js/router";
import { SeedRandom } from "@kairo-js/utils";
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { KairoRuntime } from "../minecraft/KairoRuntime";
import { ActivationController } from "./activation/ActivationController";
import { KairoError, KairoErrorReason } from "./errors/KairoError";
import { KairoInitializer } from "./init/KairoInitializer";
import { KairoRegistryIndex } from "./KairoRegistryIndex";
import { KairoUI } from "./ui/KairoUI";

const UI_TRIGGER_ITEM = "minecraft:nether_star";

class Kairo {
    private runtime?: KairoRuntime;
    private readonly registryIndex = new KairoRegistryIndex();
    private activationController?: ActivationController;
    private ui?: KairoUI;

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

    openUI(player: Player): void {
        this.ui?.open(player);
    }

    private readonly onInitComplete = () => {
        (async (): Promise<void> => {
            if (!this.runtime) {
                throw new KairoError(KairoErrorReason.RuntimeNotInitialized);
            }

            this.activationController = new ActivationController(this.runtime, this.registryIndex);
            this.activationController.setup();

            const plan = this.activationController.startupResolve();
            await this.activationController.startupActivate(plan);

            this.ui = new KairoUI(this.activationController);

            // router 経由で購読 → kairo が deactivate されると自動的に解除される
            this.router.afterEvents.itemUse.subscribe(ev => {
                if (ev.itemStack.typeId !== UI_TRIGGER_ITEM) return;
                const player = ev.source;
                system.run(() => { this.ui!.open(player); });
            });
        })();
    };
}

export const kairo = new Kairo(router);
