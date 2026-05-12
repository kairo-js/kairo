import { KairoRouter, router } from "@kairo-js/router";
import { SeedRandom } from "@kairo-js/utils";
import { KairoRuntime } from "../minecraft/KairoRuntime";
import { KairoInitializer } from "./init/KairoInitializer";

class Kairo {
    private runtime?: KairoRuntime;
    constructor(public readonly router: KairoRouter) {}
    init(): void {
        this.runtime = new KairoRuntime();

        const initializer = new KairoInitializer(this.runtime, new SeedRandom());
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });
    }
}
export const kairo = new Kairo(router);
