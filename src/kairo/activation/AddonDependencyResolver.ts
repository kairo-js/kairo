import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";

export interface MissingDependency {
    readonly source: KairoRegistry;
    readonly dependencyAddonId: string;
    readonly requiredRange: string;
}

export interface MissingPeerDependency {
    readonly source: KairoRegistry;
    readonly dependencyAddonId: string;
    readonly requiredRange: string;
}

export interface DependencyConflict {
    readonly addonId: string;
    readonly existing: KairoRegistry;
    readonly requestedBy: KairoRegistry;
    readonly requestedRange: string;
}

export interface DependencyResolutionResult {
    readonly registries: readonly KairoRegistry[];
    readonly missingDependencies: readonly MissingDependency[];
    readonly missingPeerDependencies: readonly MissingPeerDependency[];
    readonly conflicts: readonly DependencyConflict[];
}

interface ResolveContext {
    readonly resolved: Map<string, KairoRegistry>;
    readonly visiting: Set<string>;
    readonly missingDependencies: MissingDependency[];
    readonly missingPeerDependencies: MissingPeerDependency[];
    readonly conflicts: DependencyConflict[];
}

export class AddonDependencyResolver {
    constructor(private readonly registryIndex: KairoRegistryQueryable) {}

    resolve(registries: readonly KairoRegistry[]): DependencyResolutionResult {
        const context: ResolveContext = {
            resolved: new Map<string, KairoRegistry>(),
            visiting: new Set<string>(),
            missingDependencies: [],
            missingPeerDependencies: [],
            conflicts: [],
        };

        for (const registry of registries) {
            this.visit(registry, context);
        }

        return {
            registries: [...context.resolved.values()],
            missingDependencies: context.missingDependencies,
            missingPeerDependencies: context.missingPeerDependencies,
            conflicts: context.conflicts,
        };
    }

    private visit(registry: KairoRegistry, context: ResolveContext): void {
        const registryKey = this.registryIndex.createRegistryKey(registry);

        if (context.visiting.has(registryKey)) {
            return;
        }

        const locked = context.resolved.get(registry.addonId);

        if (locked) {
            this.validateConflict(locked, registry, SemVerUtils.format(registry.version), context);

            return;
        }

        context.visiting.add(registryKey);
        this.resolveDependencies(registry, context);
        context.resolved.set(registry.addonId, registry);
        this.validatePeerDependencies(registry, context);
        context.visiting.delete(registryKey);
    }

    private resolveDependencies(registry: KairoRegistry, context: ResolveContext): void {
        this.resolveDependencyMap(registry, registry.dependencies, true, context);

        this.resolveDependencyMap(registry, registry.optionalDependencies, false, context);
    }

    private resolveDependencyMap(
        registry: KairoRegistry,
        dependencies: Readonly<Record<string, string>>,
        required: boolean,
        context: ResolveContext,
    ): void {
        for (const [dependencyAddonId, requiredRange] of Object.entries(dependencies)) {
            const locked = context.resolved.get(dependencyAddonId);

            if (locked) {
                this.validateConflict(locked, registry, requiredRange, context);

                continue;
            }

            const dependency = this.registryIndex.resolveVersion(dependencyAddonId, requiredRange);

            if (!dependency) {
                if (required) {
                    context.missingDependencies.push({
                        source: registry,
                        dependencyAddonId,
                        requiredRange,
                    });
                }

                continue;
            }

            this.visit(dependency, context);
        }
    }

    private validatePeerDependencies(registry: KairoRegistry, context: ResolveContext): void {
        for (const [dependencyAddonId, requiredRange] of Object.entries(
            registry.peerDependencies,
        )) {
            const locked = context.resolved.get(dependencyAddonId);

            if (!locked) {
                context.missingPeerDependencies.push({
                    source: registry,
                    dependencyAddonId,
                    requiredRange,
                });

                continue;
            }

            this.validateConflict(locked, registry, requiredRange, context);
        }
    }

    private validateConflict(
        existing: KairoRegistry,
        requestedBy: KairoRegistry,
        requiredRange: string,
        context: ResolveContext,
    ): void {
        if (SemVerUtils.satisfies(existing.version, requiredRange)) {
            return;
        }

        context.conflicts.push({
            addonId: existing.addonId,
            existing,
            requestedBy,
            requestedRange: requiredRange,
        });
    }
}
