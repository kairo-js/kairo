import type { KairoRegistry } from "@kairo-js/router";
import type { AddonDependencySpec, AddonId, KairoId } from "../types/state";

export function buildDependencyClosure(
    targetKairoId: KairoId,
    registries: ReadonlyMap<KairoId, KairoRegistry>,
    addonIdIndex: ReadonlyMap<AddonId, ReadonlySet<KairoId>>,
    versionMatcher: (spec: AddonDependencySpec, registry: KairoRegistry) => boolean,
): ReadonlySet<KairoId> {
    const closure = new Set<KairoId>();
    const queue: KairoId[] = [targetKairoId];

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (closure.has(current)) continue;
        closure.add(current);

        const registry = registries.get(current);
        if (!registry) continue;

        for (const [addonId, versionRange] of Object.entries(registry.dependencies)) {
            const spec: AddonDependencySpec = { addonId, versionRange };
            const candidates = addonIdIndex.get(addonId);
            if (!candidates) continue;

            for (const candidateId of candidates) {
                const candidateRegistry = registries.get(candidateId);
                if (!candidateRegistry) continue;
                if (!versionMatcher(spec, candidateRegistry)) continue;
                if (!closure.has(candidateId)) queue.push(candidateId);
            }
        }

        for (const [addonId, versionRange] of Object.entries(registry.optionalDependencies)) {
            const spec: AddonDependencySpec = { addonId, versionRange };
            const candidates = addonIdIndex.get(addonId);
            if (!candidates) continue;

            for (const candidateId of candidates) {
                const candidateRegistry = registries.get(candidateId);
                if (!candidateRegistry) continue;
                if (!versionMatcher(spec, candidateRegistry)) continue;
                if (!closure.has(candidateId)) queue.push(candidateId);
            }
        }
    }

    return closure;
}
