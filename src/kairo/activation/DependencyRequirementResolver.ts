import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type { DependencyGraph, ParsedDependency } from "./DependencyGraph";
import {
    DependencyResolutionGraph,
    type DependencyCandidate,
    type DependencyResolution,
} from "./DependencyResolutionGraph";
import { VersionEvaluator } from "./VersionEvaluator";

export interface DependencyRequirementResolverOptions {
    readonly includePrerelease?: boolean;
}

export class DependencyRequirementResolver {
    constructor(
        private readonly registryIndex: KairoRegistryQueryable,
        private readonly versionEvaluator: VersionEvaluator,
    ) {}

    resolve(
        graph: DependencyGraph,
        options?: DependencyRequirementResolverOptions,
    ): DependencyResolutionGraph {
        const resolutionGraph = new DependencyResolutionGraph();

        for (const node of graph.getAll()) {
            resolutionGraph.add({
                graphNode: node,
                dependencies: this.resolveDependencies(node.dependencies, options),
                optionalDependencies: this.resolveDependencies(node.optionalDependencies, options),
                peerDependencies: this.resolveDependencies(node.peerDependencies, options),
            });
        }

        return resolutionGraph;
    }

    private resolveDependencies(
        dependencies: readonly ParsedDependency[],
        options?: DependencyRequirementResolverOptions,
    ): readonly DependencyResolution[] {
        return dependencies.map((dependency) => {
            if (dependency.expression.type === "unresolved") {
                return {
                    dependency,
                    status: "unresolved",
                    candidates: [],
                    resolved: [],
                    reason: dependency.expression.reason,
                };
            }

            const versions = this.registryIndex.getAddonVersions(dependency.addonId);

            if (versions.length === 0) {
                return {
                    dependency,
                    status: "unresolved",
                    candidates: [],
                    resolved: [],
                    reason: "missing_dependency",
                };
            }

            const candidates: DependencyCandidate[] = [];

            const resolved = versions.filter((version) => {
                const result = this.versionEvaluator.evaluate(
                    version.version,
                    dependency.expression,
                    {
                        includePrerelease: options?.includePrerelease,
                    },
                );

                if (result.satisfied || result.prereleaseOnly) {
                    candidates.push({
                        registry: version,
                        prereleaseOnly: result.prereleaseOnly,
                    });
                }

                return result.satisfied;
            });

            if (resolved.length > 0) {
                return {
                    dependency,
                    status: "resolved",
                    candidates,
                    resolved,
                };
            }

            const hasPrereleaseOnly = candidates.some((x) => x.prereleaseOnly);

            if (hasPrereleaseOnly) {
                return {
                    dependency,
                    status: "inactive",
                    candidates,
                    resolved: [],
                    reason: "prerelease_only",
                };
            }

            return {
                dependency,
                status: "inactive",
                candidates,
                resolved: [],
                reason: "dependency_conflict",
            };
        });
    }
}
