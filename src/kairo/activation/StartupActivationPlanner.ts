// StartupActivationPlanner.ts

import type { KairoRegistry } from "@kairo-js/router";

import type { KairoRegistryQueryable } from "../KairoRegistryIndex";

import type {
    AddonDependencyResolver,
    DependencyResolutionResult,
} from "./AddonDependencyResolver";

export interface InactiveAddon {
    readonly registry: KairoRegistry;

    readonly reason: "dependency_conflict" | "dependency_unresolved" | "dependency_inactive";
}

export interface UnresolvedAddon {
    readonly registry: KairoRegistry;

    readonly reason:
        | "missing_dependency"
        | "missing_peer_dependency"
        | "circular_dependency"
        | "self_dependency";
}

export interface StartupActivationPlan {
    readonly activationOrder: readonly KairoRegistry[];

    readonly inactive: readonly InactiveAddon[];

    readonly unresolved: readonly UnresolvedAddon[];
}

export class StartupActivationPlanner {
    constructor(
        private readonly registryIndex: KairoRegistryQueryable,

        private readonly resolver: AddonDependencyResolver,
    ) {}

    createPlan(): StartupActivationPlan {
        const registries = this.registryIndex.getAll();

        const result = this.resolver.resolve(registries);

        const unresolved = new Map<string, UnresolvedAddon>();

        const inactive = new Map<string, InactiveAddon>();

        this.collectRootStates(registries, result, unresolved, inactive);

        this.propagateDependencyStates(registries, unresolved, inactive);

        const candidates = registries.filter(
            (registry) => !unresolved.has(registry.addonId) && !inactive.has(registry.addonId),
        );

        return {
            activationOrder: this.topologicalSort(candidates),

            unresolved: [...unresolved.values()],

            inactive: [...inactive.values()],
        };
    }

    private collectRootStates(
        registries: readonly KairoRegistry[],

        result: DependencyResolutionResult,

        unresolved: Map<string, UnresolvedAddon>,

        inactive: Map<string, InactiveAddon>,
    ): void {
        for (const registry of registries) {
            const addonId = registry.addonId;

            if (result.selfDependencies.some((x) => x.registry.addonId === addonId)) {
                unresolved.set(addonId, {
                    registry,

                    reason: "self_dependency",
                });

                continue;
            }

            if (
                result.circularDependencies.some((x) =>
                    x.path.includes(this.registryIndex.createRegistryKey(registry)),
                )
            ) {
                unresolved.set(addonId, {
                    registry,

                    reason: "circular_dependency",
                });

                continue;
            }

            if (result.missingDependencies.some((x) => x.source.addonId === addonId)) {
                unresolved.set(addonId, {
                    registry,

                    reason: "missing_dependency",
                });

                continue;
            }

            if (result.missingPeerDependencies.some((x) => x.source.addonId === addonId)) {
                unresolved.set(addonId, {
                    registry,

                    reason: "missing_peer_dependency",
                });

                continue;
            }

            if (result.dependencyConflicts.some((x) => x.source.addonId === addonId)) {
                inactive.set(addonId, {
                    registry,

                    reason: "dependency_conflict",
                });
            }
        }
    }

    private propagateDependencyStates(
        registries: readonly KairoRegistry[],

        unresolved: Map<string, UnresolvedAddon>,

        inactive: Map<string, InactiveAddon>,
    ): void {
        let changed = true;

        while (changed) {
            changed = false;

            for (const registry of registries) {
                const addonId = registry.addonId;

                if (unresolved.has(addonId) || inactive.has(addonId)) {
                    continue;
                }

                for (const dependencyId of Object.keys(registry.dependencies)) {
                    if (unresolved.has(dependencyId)) {
                        inactive.set(addonId, {
                            registry,

                            reason: "dependency_unresolved",
                        });

                        changed = true;

                        break;
                    }

                    if (inactive.has(dependencyId)) {
                        inactive.set(addonId, {
                            registry,

                            reason: "dependency_inactive",
                        });

                        changed = true;

                        break;
                    }
                }
            }
        }
    }

    private topologicalSort(registries: readonly KairoRegistry[]): readonly KairoRegistry[] {
        const result: KairoRegistry[] = [];

        const visited = new Set<string>();

        const included = new Set(registries.map((r) => this.registryIndex.createRegistryKey(r)));

        const visit = (registry: KairoRegistry): void => {
            const key = this.registryIndex.createRegistryKey(registry);

            if (visited.has(key)) {
                return;
            }

            visited.add(key);

            for (const dependency of this.registryIndex.getDependencies(registry)) {
                const dependencyKey = this.registryIndex.createRegistryKey(dependency);

                if (!included.has(dependencyKey)) {
                    continue;
                }

                visit(dependency);
            }

            result.push(registry);
        };

        for (const registry of registries) {
            visit(registry);
        }

        return result;
    }
}
