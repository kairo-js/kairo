import type { KairoRegistry } from "@kairo-js/router";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type { AddonDependencyResolver } from "./AddonDependencyResolver";

export interface InactiveAddon {
    readonly registry: KairoRegistry;
    readonly reason: "dependency_conflict" | "dependency_inactive";
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
        private readonly index: KairoRegistryQueryable,
        private readonly resolver: AddonDependencyResolver,
    ) {}

    createPlan(): StartupActivationPlan {
        const all = this.index.getAll();
        const res = this.resolver.resolve(all);

        const inactive = new Set<string>();
        const unresolved = new Set<string>();

        const inactiveList: InactiveAddon[] = [];
        const unresolvedList: UnresolvedAddon[] = [];

        // 1. unresolved（addon単位）
        for (const r of all) {
            if (res.selfDependencies.some((x) => x.registry.addonId === r.addonId)) {
                unresolved.add(this.index.createRegistryKey(r));
                unresolvedList.push({ registry: r, reason: "self_dependency" });
            }

            if (
                res.circularDependencies.some((c) =>
                    c.path.includes(this.index.createRegistryKey(r)),
                )
            ) {
                unresolved.add(this.index.createRegistryKey(r));
                unresolvedList.push({ registry: r, reason: "circular_dependency" });
            }

            if (res.missingDependencies.some((x) => x.source.addonId === r.addonId)) {
                unresolved.add(this.index.createRegistryKey(r));
                unresolvedList.push({ registry: r, reason: "missing_dependency" });
            }

            if (res.missingPeerDependencies.some((x) => x.source.addonId === r.addonId)) {
                unresolved.add(this.index.createRegistryKey(r));
                unresolvedList.push({ registry: r, reason: "missing_peer_dependency" });
            }
        }

        // 2. conflict（★addonId単位で全version潰す）
        for (const c of res.dependencyConflicts) {
            const versions = this.index.getAddonVersions(c.addonId);

            for (const v of versions) {
                const key = this.index.createRegistryKey(v);

                inactive.add(key);
                inactiveList.push({
                    registry: v,
                    reason: "dependency_conflict",
                });
            }
        }

        // 3. propagation
        let changed = true;

        while (changed) {
            changed = false;

            for (const r of all) {
                const key = this.index.createRegistryKey(r);

                if (inactive.has(key) || unresolved.has(key)) continue;

                for (const dep of Object.keys(r.dependencies)) {
                    const depRegs = this.index.getAddonVersions(dep);

                    const blocked = depRegs.some(
                        (d) =>
                            inactive.has(this.index.createRegistryKey(d)) ||
                            unresolved.has(this.index.createRegistryKey(d)),
                    );

                    if (blocked) {
                        inactive.add(key);
                        inactiveList.push({
                            registry: r,
                            reason: "dependency_inactive",
                        });
                        changed = true;
                        break;
                    }
                }
            }
        }

        const excluded = new Set([...inactive, ...unresolved]);

        const candidates = all.filter((r) => !excluded.has(this.index.createRegistryKey(r)));

        return {
            activationOrder: this.topo(candidates),
            inactive: inactiveList,
            unresolved: unresolvedList,
        };
    }

    private topo(registries: readonly KairoRegistry[]) {
        const res: KairoRegistry[] = [];
        const visited = new Set<string>();
        const set = new Set(registries.map((r) => this.index.createRegistryKey(r)));

        const visit = (r: KairoRegistry) => {
            const key = this.index.createRegistryKey(r);
            if (visited.has(key)) return;

            visited.add(key);

            for (const d of this.index.getDependencies(r)) {
                const dk = this.index.createRegistryKey(d);
                if (!set.has(dk)) continue;
                visit(d);
            }

            res.push(r);
        };

        for (const r of registries) visit(r);

        return res;
    }
}
