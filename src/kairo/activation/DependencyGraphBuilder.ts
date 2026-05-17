import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import { DependencyGraph, type ParsedDependency } from "./DependencyGraph";
import { VersionParser } from "./VersionParser";

export class DependencyGraphBuilder {
    constructor(
        private readonly registryIndex: KairoRegistryQueryable,
        private readonly versionParser: VersionParser,
    ) {}

    build(): DependencyGraph {
        const graph = new DependencyGraph();

        for (const registry of this.registryIndex.getAll()) {
            graph.add({
                registry,
                dependencies: this.parseDependencies(registry.dependencies),
                optionalDependencies: this.parseDependencies(registry.optionalDependencies),
                peerDependencies: this.parseDependencies(registry.peerDependencies),
            });
        }

        return graph;
    }

    private parseDependencies(
        dependencies: Readonly<Record<string, string>>,
    ): readonly ParsedDependency[] {
        return Object.entries(dependencies).map(([addonId, range]) => ({
            addonId,
            range,
            expression: this.versionParser.parse(range),
        }));
    }
}
