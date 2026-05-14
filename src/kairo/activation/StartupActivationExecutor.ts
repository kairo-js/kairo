import type { KairoRegistry } from "@kairo-js/router";
import type { ActivationState, AddonInactiveReason } from "./ActivationState";
import type { StartupActivationPlan } from "./StartupActivationPlanner";
import type { ActivationResult } from "./result/schema";

export interface ActivationRequester {
    requestActivation(kairoId: string): Promise<ActivationResult>;
}

export class StartupActivationExecutor {
    constructor(
        private readonly activationState: ActivationState,
        private readonly requester: ActivationRequester,
    ) {}

    async execute(plan: StartupActivationPlan): Promise<void> {
        for (const unresolved of plan.unresolved) {
            this.activationState.set(unresolved.registry, "unresolved", unresolved.reason);
        }

        for (const inactive of plan.inactive) {
            this.activationState.set(inactive.registry, "inactive", inactive.reason);
        }

        for (const registry of plan.activationOrder) {
            if (this.hasInactiveDependency(registry)) {
                this.activationState.set(registry, "inactive", "dependency_inactive");

                continue;
            }

            if (this.hasUnresolvedDependency(registry)) {
                this.activationState.set(registry, "inactive", "dependency_unresolved");

                continue;
            }

            const result = await this.requester.requestActivation(registry.kairoId);

            if (result.status === "success") {
                this.activationState.set(registry, "active");

                continue;
            }

            if (result.status === "timeout") {
                this.activationState.set(registry, "inactive", "activation_timeout");

                continue;
            }

            this.activationState.set(registry, "inactive", result.reason as AddonInactiveReason);
        }
    }

    private hasInactiveDependency(registry: KairoRegistry): boolean {
        for (const dependencyId of Object.keys(registry.dependencies)) {
            const dependency = this.findDependency(dependencyId);

            if (!dependency) {
                continue;
            }

            if (this.activationState.isInactive(dependency.kairoId)) {
                return true;
            }
        }

        return false;
    }

    private hasUnresolvedDependency(registry: KairoRegistry): boolean {
        for (const dependencyId of Object.keys(registry.dependencies)) {
            const dependency = this.findDependency(dependencyId);

            if (!dependency) {
                continue;
            }

            if (this.activationState.isUnresolved(dependency.kairoId)) {
                return true;
            }
        }

        return false;
    }

    private findDependency(addonId: string): KairoRegistry | undefined {
        for (const entry of this.activationState.getAll()) {
            if (entry.registry.addonId === addonId) {
                return entry.registry;
            }
        }

        return undefined;
    }
}
