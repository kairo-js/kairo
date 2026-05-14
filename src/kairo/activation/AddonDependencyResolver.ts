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

export interface CircularDependency {
    readonly path: readonly string[];
}

export interface DependencyResolutionResult {
    readonly registries: readonly KairoRegistry[];
    readonly missingDependencies: readonly MissingDependency[];
    readonly missingPeerDependencies: readonly MissingPeerDependency[];
    readonly conflicts: readonly DependencyConflict[];
    readonly circularDependencies: readonly CircularDependency[];
}

interface ResolveContext {
    readonly resolved: Map<string, KairoRegistry>;
    readonly visiting: Set<string>;
    readonly stack: string[];

    readonly missingDependencies: MissingDependency[];
    readonly missingPeerDependencies: MissingPeerDependency[];
    readonly conflicts: DependencyConflict[];
    readonly circularDependencies: CircularDependency[];
}

export class AddonDependencyResolver {
    constructor(private readonly registryIndex: KairoRegistryQueryable) {}

    resolve(registries: readonly KairoRegistry[]): DependencyResolutionResult {
        const context: ResolveContext = {
            resolved: new Map(),
            visiting: new Set(),
            stack: [],
            missingDependencies: [],
            missingPeerDependencies: [],
            conflicts: [],
            circularDependencies: [],
        };

        for (const registry of registries) {
            this.visit(registry, context);
        }

        return {
            registries: [...context.resolved.values()],
            missingDependencies: context.missingDependencies,
            missingPeerDependencies: context.missingPeerDependencies,
            conflicts: context.conflicts,
            circularDependencies: context.circularDependencies,
        };
    }

    private visit(registry: KairoRegistry, context: ResolveContext): void {
        const key = this.registryIndex.createRegistryKey(registry);

        // cycle detect
        if (context.visiting.has(key)) {
            const start = context.stack.indexOf(key);

            context.circularDependencies.push({
                path: [...context.stack.slice(start), key],
            });

            return;
        }

        const locked = context.resolved.get(registry.addonId);

        if (locked) {
            this.validateConflict(locked, registry, SemVerUtils.format(registry.version), context);
            return;
        }

        context.visiting.add(key);
        context.stack.push(key);

        this.resolveDependencies(registry, context);

        context.stack.pop();
        context.visiting.delete(key);

        context.resolved.set(registry.addonId, registry);

        this.validatePeerDependencies(registry, context);
    }

    private resolveDependencies(registry: KairoRegistry, context: ResolveContext): void {
        this.resolveMap(registry, registry.dependencies, true, context);
        this.resolveMap(registry, registry.optionalDependencies, false, context);
    }

    private resolveMap(
        registry: KairoRegistry,
        deps: Readonly<Record<string, string>>,
        required: boolean,
        context: ResolveContext,
    ): void {
        for (const [id, range] of Object.entries(deps)) {
            // self dependency = error
            if (id === registry.addonId) {
                context.circularDependencies.push({
                    path: [id, id],
                });
                continue;
            }

            const locked = context.resolved.get(id);

            if (locked) {
                this.validateConflict(locked, registry, range, context);
                continue;
            }

            const resolved = this.registryIndex.resolveVersion(id, range);

            if (!resolved) {
                if (required) {
                    context.missingDependencies.push({
                        source: registry,
                        dependencyAddonId: id,
                        requiredRange: range,
                    });
                }
                continue;
            }

            this.visit(resolved, context);
        }
    }

    private validatePeerDependencies(registry: KairoRegistry, context: ResolveContext): void {
        for (const [id, range] of Object.entries(registry.peerDependencies)) {
            const locked = context.resolved.get(id);

            if (!locked) {
                context.missingPeerDependencies.push({
                    source: registry,
                    dependencyAddonId: id,
                    requiredRange: range,
                });
                continue;
            }

            this.validateConflict(locked, registry, range, context);
        }
    }

    private validateConflict(
        existing: KairoRegistry,
        requestedBy: KairoRegistry,
        range: string,
        context: ResolveContext,
    ): void {
        if (SemVerUtils.satisfies(existing.version, range)) return;

        context.conflicts.push({
            addonId: existing.addonId,
            existing,
            requestedBy,
            requestedRange: range,
        });
    }
}
