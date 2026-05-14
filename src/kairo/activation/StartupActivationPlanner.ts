import type { KairoRegistry } from "@kairo-js/router";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type {
    AddonDependencyResolver,
    CircularDependency,
    MissingDependency,
    MissingPeerDependency,
} from "./AddonDependencyResolver";

export interface InactiveAddon {
    readonly registry: KairoRegistry;
    readonly reason:
        | "dependency_conflict"
        | "missing_dependency"
        | "missing_peer_dependency"
        | "circular_dependency";
}

export interface UnresolvedAddon {
    readonly registry: KairoRegistry;
    readonly missingDependencies: readonly MissingDependency[];
    readonly missingPeerDependencies: readonly MissingPeerDependency[];
    readonly circularDependencies: readonly CircularDependency[];
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
        const res = this.resolver.resolve(registries);

        const unresolved = this.buildUnresolved(registries, res);
        const inactive = this.buildInactive(registries, res);

        const excluded = new Set<string>();

        for (const u of unresolved) {
            excluded.add(this.registryIndex.createRegistryKey(u.registry));
        }
        for (const i of inactive) {
            excluded.add(this.registryIndex.createRegistryKey(i.registry));
        }

        const candidates = res.registries.filter(
            (r) => !excluded.has(this.registryIndex.createRegistryKey(r)),
        );

        return {
            activationOrder: this.topoSort(candidates),
            inactive,
            unresolved,
        };
    }

    private buildUnresolved(registries: readonly KairoRegistry[], res: any): UnresolvedAddon[] {
        const result: UnresolvedAddon[] = [];

        for (const r of registries) {
            const key = this.registryIndex.createRegistryKey(r);

            const missingDep = res.missingDependencies.filter(
                (x: any) => this.registryIndex.createRegistryKey(x.source) === key,
            );

            const missingPeer = res.missingPeerDependencies.filter(
                (x: any) => this.registryIndex.createRegistryKey(x.source) === key,
            );

            const circular = res.circularDependencies.filter((c: any) =>
                c.path.includes(r.addonId),
            );

            if (missingDep.length || missingPeer.length || circular.length) {
                result.push({
                    registry: r,
                    missingDependencies: missingDep,
                    missingPeerDependencies: missingPeer,
                    circularDependencies: circular,
                });
            }
        }

        return result;
    }

    private buildInactive(registries: readonly KairoRegistry[], res: any): InactiveAddon[] {
        const result: InactiveAddon[] = [];

        for (const r of registries) {
            const key = this.registryIndex.createRegistryKey(r);

            const conflicts = res.conflicts.filter(
                (c: any) => this.registryIndex.createRegistryKey(c.requestedBy) === key,
            );

            const circular = res.circularDependencies.some((c: any) => c.path.includes(r.addonId));

            if (conflicts.length) {
                result.push({
                    registry: r,
                    reason: "dependency_conflict",
                });
                continue;
            }

            if (circular) {
                result.push({
                    registry: r,
                    reason: "circular_dependency",
                });
            }
        }

        return result;
    }

    private topoSort(registries: readonly KairoRegistry[]): readonly KairoRegistry[] {
        const result: KairoRegistry[] = [];
        const visited = new Set<string>();
        const set = new Set(registries.map((r) => this.registryIndex.createRegistryKey(r)));

        const visit = (r: KairoRegistry) => {
            const key = this.registryIndex.createRegistryKey(r);
            if (visited.has(key)) return;

            visited.add(key);

            for (const d of this.registryIndex.getDependencies(r)) {
                const dk = this.registryIndex.createRegistryKey(d);
                if (!set.has(dk)) continue;
                visit(d);
            }

            result.push(r);
        };

        for (const r of registries) visit(r);

        return result;
    }
}
