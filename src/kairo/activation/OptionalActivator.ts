import { SemVerUtils } from "@kairo-js/utils";
import { buildDependencyClosure } from "./resolution/DependencyClosureBuilder";
import { ResolutionService } from "./resolution/ResolutionService";
import type { ActivationExecutor } from "./ActivationExecutor";
import type { ActivationOutcome, ActivationSession } from "./types/context";
import type { AddonDependencySpec, AddonId, KairoId } from "./types/state";
import { AddonState } from "./types/state";
import type { KairoWorldState } from "./types/world";

export type OptionalActivationResult = {
    readonly outcomes: Map<KairoId, ActivationOutcome>;
    readonly reverseGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>;
};

export class OptionalActivator {
    private readonly resolutionService = new ResolutionService();

    constructor(private readonly executor: ActivationExecutor) {}

    async activateOptional(
        kairoId: KairoId,
        session: ActivationSession,
        world: KairoWorldState,
    ): Promise<OptionalActivationResult> {
        const outcomes = new Map<KairoId, ActivationOutcome>();
        const empty: OptionalActivationResult = { outcomes, reverseGraph: new Map() };

        const registry = world.registries.get(kairoId);
        if (!registry) return empty;

        // Step 0: early exit if same addonId already ACTIVE or in stack
        if (session.optionalStack.has(registry.addonId)) return empty;

        for (const rt of world.runtimes.values()) {
            if (rt.state === AddonState.ACTIVE) {
                const r = world.registries.get(rt.kairoId);
                if (r?.addonId === registry.addonId) return empty;
            }
        }

        session.optionalStack.add(registry.addonId);

        try {
            const versionMatcher = (spec: AddonDependencySpec, reg: typeof registry): boolean =>
                SemVerUtils.satisfies(reg.version, spec.versionRange);

            const closure = buildDependencyClosure(kairoId, world.registries, world.addonIdIndex, versionMatcher);
            const scope = new Set<KairoId>(closure);

            // Add same addonId groups for conflict detection
            for (const closureId of closure) {
                const r = world.registries.get(closureId);
                if (!r) continue;
                const group = world.addonIdIndex.get(r.addonId);
                if (group) for (const gId of group) scope.add(gId);

                // Add currently ACTIVE conflicting versions
                const activeIds = world.addonIdIndex.get(r.addonId);
                if (activeIds) {
                    for (const activeId of activeIds) {
                        if (world.runtimes.get(activeId)?.state === AddonState.ACTIVE) scope.add(activeId);
                    }
                }
            }

            const plan = this.resolutionService.resolve(world, scope);
            const blockedKairoIds = new Set<KairoId>();

            for (const id of plan.orderedKairoIds) {
                if (blockedKairoIds.has(id)) continue;

                const outcome = await this.executor.activate(id);
                outcomes.set(id, outcome);

                if (outcome.type !== "SUCCESS") {
                    const deps = plan.resolvedReverseDependencyGraph.get(id);
                    if (deps) {
                        for (const depId of deps) blockedKairoIds.add(depId);
                    }
                }
            }

            return { outcomes, reverseGraph: plan.resolvedReverseDependencyGraph };
        } finally {
            session.optionalStack.delete(registry.addonId);
        }
    }
}
