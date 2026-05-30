import { InactiveReasonCode, type AddonRuntimeState, type KairoId } from "../types/state";
import { setInactive } from "./RuntimeTransition";

export function markBlockedDependents(
    failedKairoId: KairoId,
    reverseGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
    runtimes: ReadonlyMap<KairoId, AddonRuntimeState>,
    blockedKairoIds: Set<KairoId>,
): void {
    const queue: KairoId[] = [failedKairoId];

    while (queue.length > 0) {
        const current = queue.shift()!;
        const dependents = reverseGraph.get(current);
        if (!dependents) continue;

        for (const depId of dependents) {
            if (blockedKairoIds.has(depId)) continue;

            blockedKairoIds.add(depId);

            const runtime = runtimes.get(depId);
            if (runtime) {
                setInactive(runtime, {
                    code: InactiveReasonCode.DEPENDENCY_INACTIVE,
                    message: `Dependency ${current} failed to activate`,
                    related: [current],
                });
            }

            queue.push(depId);
        }
    }
}
