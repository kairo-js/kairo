import type { ActivationPlan } from "../types/plan";
import { AddonState, InactiveReasonCode, type AddonRuntimeState, type KairoId } from "../types/state";
import type { PreviousSessionStore } from "../types/world";

export class ActivationPlanner {
    buildPlan(
        scope: ReadonlyMap<KairoId, AddonRuntimeState>,
        runtimes: ReadonlyMap<KairoId, AddonRuntimeState>,
        dependencyGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
        resolvedReverseDependencyGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
        previousSession: PreviousSessionStore,
    ): ActivationPlan {
        const activeIds = new Set<KairoId>();
        for (const [id, rt] of runtimes) {
            if (rt.state === AddonState.ACTIVE) activeIds.add(id);
        }

        const availableDependencies = new Set<KairoId>(activeIds);
        const inDegree = new Map<KairoId, number>();

        // Compute in-degree within scope (count deps not yet available)
        for (const [kairoId] of scope) {
            const deps = dependencyGraph.get(kairoId) ?? new Set();
            let count = 0;
            for (const dep of deps) {
                if (!availableDependencies.has(dep)) count++;
            }
            inDegree.set(kairoId, count);
        }

        const prioritize = (ids: KairoId[]): KairoId[] => {
            return ids.sort((a, b) => {
                const ra = scope.get(a);
                const rb = scope.get(b);
                const pa = this.priority(a, ra, runtimes, previousSession);
                const pb = this.priority(b, rb, runtimes, previousSession);
                return pa - pb;
            });
        };

        const initialQueue = prioritize(
            [...scope.keys()].filter(id => canActivate(id, availableDependencies, scope, dependencyGraph)),
        );

        const queue: KairoId[] = initialQueue;
        const orderedKairoIds: KairoId[] = [];

        while (queue.length > 0) {
            const id = queue.shift()!;
            if (!canActivate(id, availableDependencies, scope, dependencyGraph)) continue;

            orderedKairoIds.push(id);
            availableDependencies.add(id);

            const dependents = resolvedReverseDependencyGraph.get(id) ?? new Set();
            const newlyReady: KairoId[] = [];

            for (const depId of dependents) {
                if (!scope.has(depId)) continue;
                const current = inDegree.get(depId) ?? 0;
                const updated = Math.max(0, current - 1);
                inDegree.set(depId, updated);

                if (updated === 0 && canActivate(depId, availableDependencies, scope, dependencyGraph)) {
                    newlyReady.push(depId);
                }
            }

            queue.push(...prioritize(newlyReady));
        }

        return { orderedKairoIds, resolvedReverseDependencyGraph };
    }

    private priority(
        kairoId: KairoId,
        _runtime: AddonRuntimeState | undefined,
        _runtimes: ReadonlyMap<KairoId, AddonRuntimeState>,
        previousSession: PreviousSessionStore,
    ): number {
        for (const [, entry] of previousSession) {
            if (entry.origin === "explicit") return 0;
        }
        // Simple heuristic: check if addonId appears in previousSession
        // For now, use kairoId lexicographic order as tiebreaker
        return 2;
    }
}

function canActivate(
    kairoId: KairoId,
    availableDependencies: ReadonlySet<KairoId>,
    scope: ReadonlyMap<KairoId, AddonRuntimeState>,
    dependencyGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
): boolean {
    if (!scope.has(kairoId)) return false;

    const runtime = scope.get(kairoId);
    if (!runtime) return false;
    if (runtime.state !== AddonState.INACTIVE) return false;
    if (runtime.inactiveReasons.has(InactiveReasonCode.ACTIVATION_TIMEOUT)) return false;
    if (runtime.inactiveReasons.has(InactiveReasonCode.ADDON_ID_CONFLICT)) return false;
    if (runtime.inactiveReasons.has(InactiveReasonCode.PRERELEASE_ONLY)) return false;
    if (runtime.inactiveReasons.has(InactiveReasonCode.MANUALLY_DEACTIVATED)) return false;

    for (const depId of dependencyGraph.get(kairoId) ?? []) {
        if (!availableDependencies.has(depId)) return false;
    }

    return true;
}
