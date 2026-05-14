import type { KairoRegistry } from "@kairo-js/router";

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
    readonly source: KairoRegistry;

    readonly dependencyAddonId: string;

    readonly requiredRange: string;

    readonly existingVersions: readonly KairoRegistry[];
}

export interface CircularDependency {
    readonly path: readonly string[];
}

export interface SelfDependency {
    readonly registry: KairoRegistry;
}

export interface DependencyResolutionResult {
    readonly validRegistries: readonly KairoRegistry[];

    readonly missingDependencies: readonly MissingDependency[];

    readonly missingPeerDependencies: readonly MissingPeerDependency[];

    readonly dependencyConflicts: readonly DependencyConflict[];

    readonly circularDependencies: readonly CircularDependency[];

    readonly selfDependencies: readonly SelfDependency[];
}

interface ResolveContext {
    readonly visiting: Set<string>;

    readonly valid: Set<string>;

    readonly invalid: Set<string>;

    readonly stack: string[];

    readonly missingDependencies: MissingDependency[];

    readonly missingPeerDependencies: MissingPeerDependency[];

    readonly dependencyConflicts: DependencyConflict[];

    readonly circularDependencies: CircularDependency[];

    readonly selfDependencies: SelfDependency[];
}

export class AddonDependencyResolver {
    constructor(private readonly registryIndex: KairoRegistryQueryable) {}

    resolve(registries: readonly KairoRegistry[]): DependencyResolutionResult {
        const context: ResolveContext = {
            visiting: new Set(),

            valid: new Set(),

            invalid: new Set(),

            stack: [],

            missingDependencies: [],

            missingPeerDependencies: [],

            dependencyConflicts: [],

            circularDependencies: [],

            selfDependencies: [],
        };

        for (const registry of registries) {
            this.visit(registry, context);
        }

        return {
            validRegistries: registries.filter((r) =>
                context.valid.has(this.registryIndex.createRegistryKey(r)),
            ),

            missingDependencies: context.missingDependencies,

            missingPeerDependencies: context.missingPeerDependencies,

            dependencyConflicts: context.dependencyConflicts,

            circularDependencies: context.circularDependencies,

            selfDependencies: context.selfDependencies,
        };
    }

    private visit(
        registry: KairoRegistry,

        context: ResolveContext,
    ): boolean {
        const key = this.registryIndex.createRegistryKey(registry);

        if (context.valid.has(key)) {
            return true;
        }

        if (context.invalid.has(key)) {
            return false;
        }

        if (context.visiting.has(key)) {
            const start = context.stack.indexOf(key);

            const cycle = [...context.stack.slice(start), key];

            context.circularDependencies.push({
                path: cycle,
            });

            for (const cycleKey of cycle) {
                context.invalid.add(cycleKey);
            }

            return false;
        }

        context.visiting.add(key);

        context.stack.push(key);

        let success = true;

        success &&= this.resolveDependencies(registry, context);

        success &&= this.validatePeerDependencies(registry, context);

        context.stack.pop();

        context.visiting.delete(key);

        if (!success) {
            context.invalid.add(key);

            return false;
        }

        context.valid.add(key);

        return true;
    }

    private resolveDependencies(
        registry: KairoRegistry,

        context: ResolveContext,
    ): boolean {
        let success = true;

        success &&= this.resolveMap(registry, registry.dependencies, true, context);

        success &&= this.resolveMap(registry, registry.optionalDependencies, false, context);

        return success;
    }

    private resolveMap(
        registry: KairoRegistry,

        dependencies: Readonly<Record<string, string>>,

        required: boolean,

        context: ResolveContext,
    ): boolean {
        let success = true;

        for (const [addonId, range] of Object.entries(dependencies)) {
            if (addonId === registry.addonId) {
                context.selfDependencies.push({
                    registry,
                });

                context.invalid.add(this.registryIndex.createRegistryKey(registry));

                success = false;

                continue;
            }

            const versions = this.registryIndex.getAddonVersions(addonId);

            if (versions.length === 0) {
                if (required) {
                    context.missingDependencies.push({
                        source: registry,

                        dependencyAddonId: addonId,

                        requiredRange: range,
                    });

                    context.invalid.add(this.registryIndex.createRegistryKey(registry));

                    success = false;
                }

                continue;
            }

            const resolved = this.registryIndex.resolveVersion(addonId, range);

            if (!resolved) {
                context.dependencyConflicts.push({
                    source: registry,

                    dependencyAddonId: addonId,

                    requiredRange: range,

                    existingVersions: versions,
                });

                success = false;

                continue;
            }

            const childSuccess = this.visit(resolved, context);

            if (!childSuccess) {
                success = false;
            }
        }

        return success;
    }

    private validatePeerDependencies(
        registry: KairoRegistry,

        context: ResolveContext,
    ): boolean {
        let success = true;

        for (const [addonId, range] of Object.entries(registry.peerDependencies)) {
            const versions = this.registryIndex.getAddonVersions(addonId);

            if (versions.length === 0) {
                context.missingPeerDependencies.push({
                    source: registry,

                    dependencyAddonId: addonId,

                    requiredRange: range,
                });

                context.invalid.add(this.registryIndex.createRegistryKey(registry));

                success = false;

                continue;
            }

            const resolved = this.registryIndex.resolveVersion(addonId, range);

            if (!resolved) {
                context.dependencyConflicts.push({
                    source: registry,

                    dependencyAddonId: addonId,

                    requiredRange: range,

                    existingVersions: versions,
                });

                success = false;
            }
        }

        return success;
    }
}
