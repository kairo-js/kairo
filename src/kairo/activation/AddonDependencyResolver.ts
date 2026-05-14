import type { KairoRegistry } from "@kairo-js/router";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";

export interface MissingDependency {
    readonly source: KairoRegistry;
    readonly addonId: string;
    readonly range: string;
}

export interface MissingPeerDependency {
    readonly source: KairoRegistry;
    readonly addonId: string;
    readonly range: string;
}

export interface DependencyConflict {
    readonly addonId: string; // conflict target
    readonly requiredBy: KairoRegistry;
    readonly requiredRange: string;
    readonly candidates: readonly KairoRegistry[];
}

export interface CircularDependency {
    readonly path: readonly string[];
}

export interface SelfDependency {
    readonly registry: KairoRegistry;
}

export interface DependencyResolutionResult {
    readonly registries: readonly KairoRegistry[];

    readonly missingDependencies: readonly MissingDependency[];
    readonly missingPeerDependencies: readonly MissingPeerDependency[];
    readonly dependencyConflicts: readonly DependencyConflict[];
    readonly circularDependencies: readonly CircularDependency[];
    readonly selfDependencies: readonly SelfDependency[];
}

interface Context {
    visiting: Set<string>;
    stack: string[];

    resolved: Map<string, KairoRegistry>;

    missing: MissingDependency[];
    missingPeer: MissingPeerDependency[];
    conflicts: DependencyConflict[];
    cycles: CircularDependency[];
    self: SelfDependency[];
}

export class AddonDependencyResolver {
    constructor(private readonly index: KairoRegistryQueryable) {}

    resolve(registries: readonly KairoRegistry[]): DependencyResolutionResult {
        const ctx: Context = {
            visiting: new Set(),
            stack: [],
            resolved: new Map(),
            missing: [],
            missingPeer: [],
            conflicts: [],
            cycles: [],
            self: [],
        };

        for (const r of registries) {
            this.visit(r, ctx);
        }

        return {
            registries: [...ctx.resolved.values()],
            missingDependencies: ctx.missing,
            missingPeerDependencies: ctx.missingPeer,
            dependencyConflicts: ctx.conflicts,
            circularDependencies: ctx.cycles,
            selfDependencies: ctx.self,
        };
    }

    private visit(registry: KairoRegistry, ctx: Context): boolean {
        const key = this.index.createRegistryKey(registry);

        if (ctx.resolved.has(registry.addonId)) return true;

        if (ctx.visiting.has(key)) {
            const i = ctx.stack.indexOf(key);
            ctx.cycles.push({ path: [...ctx.stack.slice(i), key] });
            return false;
        }

        ctx.visiting.add(key);
        ctx.stack.push(key);

        let ok = true;

        ok &&= this.resolveDeps(registry, ctx);
        ok &&= this.resolvePeers(registry, ctx);

        ctx.stack.pop();
        ctx.visiting.delete(key);

        if (ok) ctx.resolved.set(registry.addonId, registry);

        return ok;
    }

    private resolveDeps(registry: KairoRegistry, ctx: Context): boolean {
        let ok = true;

        ok &&= this.resolveMap(registry, registry.dependencies, true, ctx);
        ok &&= this.resolveMap(registry, registry.optionalDependencies, false, ctx);

        return ok;
    }

    private resolveMap(
        registry: KairoRegistry,
        deps: Record<string, string>,
        required: boolean,
        ctx: Context,
    ): boolean {
        let ok = true;

        for (const [addonId, range] of Object.entries(deps)) {
            if (addonId === registry.addonId) {
                ctx.self.push({ registry });
                ok = false;
                continue;
            }

            const candidates = this.index.getAddonVersions(addonId);
            const match = this.index.resolveVersion(addonId, range);

            if (!match) {
                if (required) {
                    ctx.missing.push({
                        source: registry,
                        addonId,
                        range,
                    });
                    ok = false;
                }
                continue;
            }

            this.visit(match, ctx);
        }

        return ok;
    }

    private resolvePeers(registry: KairoRegistry, ctx: Context): boolean {
        let ok = true;

        for (const [addonId, range] of Object.entries(registry.peerDependencies)) {
            const match = this.index.resolveVersion(addonId, range);

            if (!match) {
                ctx.missingPeer.push({
                    source: registry,
                    addonId,
                    range,
                });
                ok = false;
            }
        }

        return ok;
    }
}
