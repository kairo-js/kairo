import type { KairoRegistry } from "@kairo-js/router";
import type { DependencyResolutionGraph } from "./DependencyResolutionGraph";

export interface ActivationConflict {
    readonly addonId: string;
    readonly registries: readonly KairoRegistry[];
}

export class ActivationConflictResolver {
    resolve(graph: DependencyResolutionGraph): readonly ActivationConflict[] {
        const map = new Map<string, Set<string>>();

        for (const node of graph.getAll()) {
            const registry = node.graphNode.registry;

            let set = map.get(registry.addonId);

            if (!set) {
                set = new Set<string>();

                map.set(registry.addonId, set);
            }

            set.add(registry.kairoId);

            for (const dependency of node.dependencies) {
                for (const resolved of dependency.resolved) {
                    if (resolved.addonId !== registry.addonId) {
                        continue;
                    }

                    set.add(resolved.kairoId);
                }
            }
        }

        const conflicts: ActivationConflict[] = [];

        for (const [addonId, ids] of map) {
            if (ids.size <= 1) {
                continue;
            }

            const registries = graph
                .getAll()
                .map((x) => x.graphNode.registry)
                .filter((x) => ids.has(x.kairoId));

            conflicts.push({
                addonId,
                registries,
            });
        }

        return conflicts;
    }
}
