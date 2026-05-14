import type { KairoRegistry } from "@kairo-js/router";
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
        for (const u of plan.unresolved) {
            this.activationState.set(u.registry, "unresolved", "dependency_issue");
        }

        for (const i of plan.inactive) {
            this.activationState.set(i.registry, "inactive", i.reason);
        }

        const failed = new Set<string>();

        for (const r of plan.activationOrder) {
            if (this.hasFailedDependency(r, failed)) {
                this.activationState.set(r, "inactive", "dependency_activation_failed");
                failed.add(r.addonId);
                continue;
            }

            const res = await this.requester.requestActivation(r.kairoId);

            if (res.status === "success") {
                this.activationState.set(r, "active");
                continue;
            }

            this.activationState.set(r, "inactive", res.reason ?? "activation_failed");
            failed.add(r.addonId);
        }
    }

    private hasFailedDependency(registry: KairoRegistry, failed: ReadonlySet<string>): boolean {
        for (const id of Object.keys(registry.dependencies)) {
            if (failed.has(id)) return true;
        }
        return false;
    }
}
