import type { KairoRegistry } from "@kairo-js/router";

import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type {
    AddonDependencyResolver,
    DependencyConflict,
    MissingDependency,
    MissingPeerDependency,
} from "./AddonDependencyResolver";

export interface InactiveAddon {
    readonly registry: KairoRegistry;
    readonly reason: "dependency_conflict";
    readonly conflicts: readonly DependencyConflict[];
}

export interface UnresolvedAddon {
    readonly registry: KairoRegistry;
    readonly reason: "missing_dependency" | "missing_peer_dependency";
    readonly missingDependencies: readonly MissingDependency[];
    readonly missingPeerDependencies: readonly MissingPeerDependency[];
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

        const resolution = this.resolver.resolve(registries);

        const unresolved = this.createUnresolvedAddons(
            registries,
            resolution.missingDependencies,
            resolution.missingPeerDependencies,
        );

        const inactive = this.createInactiveAddons(registries, resolution.conflicts);

        const excluded = new Set<string>();

        for (const addon of unresolved) {
            excluded.add(this.registryIndex.createRegistryKey(addon.registry));
        }

        for (const addon of inactive) {
            excluded.add(this.registryIndex.createRegistryKey(addon.registry));
        }

        const activationCandidates = resolution.registries.filter(
            (registry) => !excluded.has(this.registryIndex.createRegistryKey(registry)),
        );

        const activationOrder = this.sortTopologically(activationCandidates);

        return {
            activationOrder,
            inactive,
            unresolved,
        };
    }

    private createInactiveAddons(
        registries: readonly KairoRegistry[],
        conflicts: readonly DependencyConflict[],
    ): readonly InactiveAddon[] {
        const map = new Map<string, DependencyConflict[]>();

        for (const conflict of conflicts) {
            const key = this.registryIndex.createRegistryKey(conflict.requestedBy);

            const list = map.get(key) ?? [];

            list.push(conflict);

            map.set(key, list);
        }

        const result: InactiveAddon[] = [];

        for (const registry of registries) {
            const key = this.registryIndex.createRegistryKey(registry);

            const addonConflicts = map.get(key);

            if (!addonConflicts) {
                continue;
            }

            result.push({
                registry,
                reason: "dependency_conflict",
                conflicts: addonConflicts,
            });
        }

        return result;
    }

    private createUnresolvedAddons(
        registries: readonly KairoRegistry[],
        missingDependencies: readonly MissingDependency[],
        missingPeerDependencies: readonly MissingPeerDependency[],
    ): readonly UnresolvedAddon[] {
        const dependencyMap = new Map<string, MissingDependency[]>();

        const peerMap = new Map<string, MissingPeerDependency[]>();

        for (const missing of missingDependencies) {
            const key = this.registryIndex.createRegistryKey(missing.source);

            const list = dependencyMap.get(key) ?? [];

            list.push(missing);

            dependencyMap.set(key, list);
        }

        for (const missing of missingPeerDependencies) {
            const key = this.registryIndex.createRegistryKey(missing.source);

            const list = peerMap.get(key) ?? [];

            list.push(missing);

            peerMap.set(key, list);
        }

        const result: UnresolvedAddon[] = [];

        for (const registry of registries) {
            const key = this.registryIndex.createRegistryKey(registry);

            const addonMissingDependencies = dependencyMap.get(key) ?? [];

            const addonMissingPeerDependencies = peerMap.get(key) ?? [];

            if (
                addonMissingDependencies.length === 0 &&
                addonMissingPeerDependencies.length === 0
            ) {
                continue;
            }

            result.push({
                registry,
                reason:
                    addonMissingDependencies.length > 0
                        ? "missing_dependency"
                        : "missing_peer_dependency",
                missingDependencies: addonMissingDependencies,
                missingPeerDependencies: addonMissingPeerDependencies,
            });
        }

        return result;
    }

    private sortTopologically(registries: readonly KairoRegistry[]): readonly KairoRegistry[] {
        const result: KairoRegistry[] = [];

        const visited = new Set<string>();

        const registrySet = new Set(
            registries.map((registry) => this.registryIndex.createRegistryKey(registry)),
        );

        for (const registry of registries) {
            this.visit(registry, registrySet, visited, result);
        }

        return result;
    }

    private visit(
        registry: KairoRegistry,
        registrySet: ReadonlySet<string>,
        visited: Set<string>,
        result: KairoRegistry[],
    ): void {
        const key = this.registryIndex.createRegistryKey(registry);

        if (visited.has(key)) {
            return;
        }

        visited.add(key);

        for (const dependency of this.registryIndex.getDependencies(registry)) {
            const dependencyKey = this.registryIndex.createRegistryKey(dependency);

            if (!registrySet.has(dependencyKey)) {
                continue;
            }

            this.visit(dependency, registrySet, visited, result);
        }

        result.push(registry);
    }
}
