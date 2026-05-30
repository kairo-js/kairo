import type { ActivationExecutor } from "./ActivationExecutor";
import type { KairoId } from "./types/state";

export class DeactivationExecutor {
    constructor(private readonly executor: ActivationExecutor) {}

    async deactivate(kairoId: KairoId): Promise<boolean> {
        const outcome = await this.executor.deactivate(kairoId);
        return outcome.type === "SUCCESS";
    }
}
