import type { KairoRegistry } from "@kairo-js/router";
import type { AddonDependencySpec, KairoId } from "../types/state";

export type DeclaredDependencyGraph = ReadonlyMap<KairoId, ReadonlySet<AddonDependencySpec>>;

export function buildDeclaredGraph(
    registries: Iterable<KairoRegistry>,
): Map<KairoId, Set<AddonDependencySpec>> {
    const graph = new Map<KairoId, Set<AddonDependencySpec>>();

    for (const registry of registries) {
        const specs = new Set<AddonDependencySpec>();

        for (const [addonId, versionRange] of Object.entries(registry.dependencies)) {
            specs.add({ addonId, versionRange });
        }

        graph.set(registry.kairoId, specs);
    }

    return graph;
}
