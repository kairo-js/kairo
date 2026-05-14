import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";
import type { ActivationState } from "./ActivationState";
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

        const failedAddonIds = new Set<string>();

        for (const registry of plan.activationOrder) {
            if (this.hasFailedDependency(registry, failedAddonIds)) {
                this.activationState.set(registry, "inactive", "dependency_activation_failed");

                failedAddonIds.add(registry.addonId);

                continue;
            }

            const result = await this.requester.requestActivation(registry.kairoId);

            if (result.status === "success") {
                this.activationState.set(registry, "active");

                console.log(
                    `Activated addon: ${registry.addonId}@${SemVerUtils.format(registry.version)}`,
                );

                continue;
            }

            this.activationState.set(registry, "inactive", result.reason ?? "activation_failed");

            console.log(
                `§cFailed to activate addon: ${registry.addonId}@${SemVerUtils.format(registry.version)} - Status: ${result.status}§r`,
            );

            failedAddonIds.add(registry.addonId);
        }
    }

    private hasFailedDependency(
        registry: KairoRegistry,
        failedAddonIds: ReadonlySet<string>,
    ): boolean {
        for (const dependencyAddonId of Object.keys(registry.dependencies)) {
            if (failedAddonIds.has(dependencyAddonId)) {
                return true;
            }
        }

        return false;
    }
}
