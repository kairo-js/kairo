import type { Random } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import {
    ProvideIdRegistryError,
    ProvideIdRegistryErrorReason,
} from "./discovery/registryProvider/errors";

export class IdRegistryProvider {
    private readonly CHARSET =
        "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "0123456789" + "?_-().";
    private readonly ID_LENGTH = 12;

    constructor(private readonly random: Random) {}

    provideRegistry(runtime: KairoRuntime): string {
        const prefix = "krid-";

        let registryId: string;
        let attempts = 0;

        do {
            registryId = `${prefix}${this.generateId()}`;
            attempts++;

            if (attempts > 100) {
                throw new ProvideIdRegistryError(ProvideIdRegistryErrorReason.IdGenerationFailed);
            }
        } while (runtime.hasRegistry(registryId));

        runtime.addRegistry(registryId, "kairo:id_checker");
        return registryId;
    }

    private generateId(length: number = this.ID_LENGTH): string {
        const chars = this.CHARSET;
        let result = "";

        for (let i = 0; i < length; i++) {
            result += chars[(this.random.next() * chars.length) | 0];
        }

        return result;
    }
}
