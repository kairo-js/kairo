import type { ActivationState } from "../activation/ActivationState";
import type { ActivationConflict } from "./ActivationConflictResolver";

export class ActivationConflictApplicator {
    apply(conflicts: readonly ActivationConflict[], activationState: ActivationState): void {
        for (const conflict of conflicts) {
            for (const registry of conflict.registries) {
                if (activationState.isUnresolved(registry.kairoId)) {
                    continue;
                }

                activationState.set(registry, "inactive", "dependency_conflict");
            }
        }
    }
}
