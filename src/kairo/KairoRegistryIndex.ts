import type { SemVer } from "@kairo-js/properties";
import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";
import type { ApiManifest } from "./init/api/ApiManifestSchema";
import type { HandoffRegistryEntry } from "./handoff/HandoffPayload";

export type KairoRegistryWithManifest = {
    readonly registry: KairoRegistry;
    readonly manifest: ApiManifest;
};

export interface KairoRegistryQueryable {
    hasAddonVersion(addonId: string, version: SemVer): boolean;
    getAddonVersion(addonId: string, version: SemVer): KairoRegistry | undefined;
    getAddonVersions(addonId: string): readonly KairoRegistry[];
    getLatestAddonVersion(addonId: string): KairoRegistry | undefined;
    getDependents(addonId: string): readonly KairoRegistry[];
    getAll(): readonly KairoRegistry[];
    getAllWithManifests(): readonly KairoRegistryWithManifest[];
    createRegistryKey(registry: KairoRegistry): string;
}

export class KairoRegistryIndex implements KairoRegistryQueryable {
    private readonly byKey = new Map<string, KairoRegistryWithManifest>();
    private readonly byAddonId = new Map<string, KairoRegistry[]>();
    private readonly dependents = new Map<string, Set<string>>();
    private _packExecutionOrder: readonly string[] = [];

    add(registry: KairoRegistry): void {
        const key = this.createRegistryKey(registry);

        if (this.byKey.has(key)) {
            throw new Error(`Registry already exists: ${key}`);
        }

        this.byKey.set(key, { registry, manifest: { apis: [], hooks: [], eventSubscriptions: [] } });
        this.indexByAddonId(registry);
        this.indexDependents(registry);
    }

    loadFromHandoff(entries: readonly HandoffRegistryEntry[]): void {
        this.byKey.clear();
        this.byAddonId.clear();
        this.dependents.clear();

        for (const entry of entries) {
            const registry: KairoRegistry = {
                kairoId: entry.kairoId,
                addonId: entry.addonId,
                version: {
                    major: entry.version.ma,
                    minor: entry.version.mi,
                    patch: entry.version.p,
                    ...(entry.version.pre !== undefined ? { prerelease: entry.version.pre } : {}),
                },
                name: entry.name,
                description: entry.description,
                metadata: {
                    authors: [...entry.metadata.authors],
                    url: entry.metadata.url,
                    license: entry.metadata.license,
                },
                dependencies: { ...entry.dependencies },
                optionalDependencies: { ...entry.optionalDependencies },
                tags: [...entry.tags],
            };
            const manifest: ApiManifest = {
                apis: entry.manifest.apis.map((a) => ({ name: a.name })),
                hooks: entry.manifest.hooks.map((h) => ({
                    targetAddonId: h.targetAddonId,
                    apiName: h.apiName,
                    priority: h.priority,
                    phases: h.phases as Array<"before" | "after">,
                    declarationSequence: h.declarationSequence,
                    hasRollback: h.hasRollback,
                })),
                eventSubscriptions: entry.manifest.eventSubscriptions.map((s) => ({
                    emitterAddonId: s.emitterAddonId,
                    eventName: s.eventName,
                })),
            };
            const key = this.createRegistryKey(registry);
            this.byKey.set(key, { registry, manifest });
            this.indexByAddonId(registry);
            this.indexDependents(registry);
        }
    }

    setPackExecutionOrder(order: readonly string[]): void {
        this._packExecutionOrder = order;
    }

    getPackExecutionOrder(): readonly string[] {
        return this._packExecutionOrder;
    }

    setManifest(kairoId: string, manifest: ApiManifest): void {
        for (const [key, entry] of this.byKey) {
            if (entry.registry.kairoId === kairoId) {
                this.byKey.set(key, { registry: entry.registry, manifest });
                return;
            }
        }
    }

    hasAddonVersion(addonId: string, version: SemVer): boolean {
        return this.byKey.has(this.createKey(addonId, version));
    }

    getAddonVersion(addonId: string, version: SemVer): KairoRegistry | undefined {
        return this.byKey.get(this.createKey(addonId, version))?.registry;
    }

    getAddonVersions(addonId: string): readonly KairoRegistry[] {
        return this.byAddonId.get(addonId) ?? [];
    }

    getLatestAddonVersion(addonId: string): KairoRegistry | undefined {
        return this.byAddonId.get(addonId)?.[0];
    }

    getDependents(addonId: string): readonly KairoRegistry[] {
        const set = this.dependents.get(addonId);
        if (!set) return [];

        const result: KairoRegistry[] = [];

        for (const dependentId of set) {
            const list = this.byAddonId.get(dependentId);
            if (!list) continue;
            result.push(...list);
        }

        return result;
    }

    getAll(): readonly KairoRegistry[] {
        return [...this.byKey.values()].map((v) => v.registry);
    }

    getAllWithManifests(): readonly KairoRegistryWithManifest[] {
        return [...this.byKey.values()];
    }

    createRegistryKey(registry: KairoRegistry): string {
        return this.createKey(registry.addonId, registry.version);
    }

    private indexByAddonId(registry: KairoRegistry): void {
        const list = this.byAddonId.get(registry.addonId) ?? [];
        list.push(registry);

        list.sort((a, b) => SemVerUtils.rcompare(a.version, b.version));

        this.byAddonId.set(registry.addonId, list);
    }

    private indexDependents(registry: KairoRegistry): void {
        for (const depAddonId of Object.keys(registry.dependencies)) {
            let set = this.dependents.get(depAddonId);

            if (!set) {
                set = new Set<string>();
                this.dependents.set(depAddonId, set);
            }

            set.add(registry.addonId);
        }
    }

    private createKey(addonId: string, version: SemVer): string {
        return `${addonId}@${SemVerUtils.format(version)}`;
    }
}
