import type { SemVer } from "@kairo-js/properties";
import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";

export interface KairoRegistryQueryable {
    hasAddonVersion(addonId: string, version: SemVer): boolean;
    getAddonVersion(addonId: string, version: SemVer): KairoRegistry | undefined;
    getAddonVersions(addonId: string): readonly KairoRegistry[];
    getLatestAddonVersion(addonId: string): KairoRegistry | undefined;
    resolveVersion(addonId: string, range: string): KairoRegistry | undefined;
    getDependents(addonId: string): readonly KairoRegistry[];
    getDependencies(registry: KairoRegistry): readonly KairoRegistry[];
    getAll(): readonly KairoRegistry[];
    createRegistryKey(registry: KairoRegistry): string;
}

export class KairoRegistryIndex implements KairoRegistryQueryable {
    private readonly byAddonVersion = new Map<string, KairoRegistry>();
    private readonly byAddonId = new Map<string, KairoRegistry[]>();
    private readonly dependents = new Map<string, Set<string>>();

    add(registry: KairoRegistry): void {
        const key = this.createRegistryKey(registry);
        if (this.byAddonVersion.has(key)) {
            throw new Error(`Registry already exists: ${key}`);
        }
        this.byAddonVersion.set(key, registry);
        this.indexAddonVersion(registry);
        this.indexDependents(registry);
    }

    hasAddonVersion(addonId: string, version: SemVer): boolean {
        return this.byAddonVersion.has(this.createKey(addonId, version));
    }

    getAddonVersion(addonId: string, version: SemVer): KairoRegistry | undefined {
        return this.byAddonVersion.get(this.createKey(addonId, version));
    }

    getAddonVersions(addonId: string): readonly KairoRegistry[] {
        return this.byAddonId.get(addonId) ?? [];
    }

    getLatestAddonVersion(addonId: string): KairoRegistry | undefined {
        return this.byAddonId.get(addonId)?.[0];
    }

    resolveVersion(addonId: string, range: string): KairoRegistry | undefined {
        const registries = this.byAddonId.get(addonId);
        if (!registries) return undefined;
        for (const registry of registries) {
            if (SemVerUtils.satisfies(registry.version, range)) {
                return registry;
            }
        }
        return undefined;
    }

    getDependents(addonId: string): readonly KairoRegistry[] {
        const addonIds = this.dependents.get(addonId);
        if (!addonIds) return [];
        const result: KairoRegistry[] = [];
        for (const dependentAddonId of addonIds) {
            const registries = this.byAddonId.get(dependentAddonId);
            if (!registries) continue;
            result.push(...registries);
        }
        return result;
    }

    getDependencies(registry: KairoRegistry): readonly KairoRegistry[] {
        const result: KairoRegistry[] = [];
        for (const [addonId, range] of Object.entries(registry.dependencies)) {
            const resolved = this.resolveVersion(addonId, range);
            if (resolved) result.push(resolved);
        }
        return result;
    }

    getAll(): readonly KairoRegistry[] {
        return [...this.byAddonVersion.values()];
    }

    createRegistryKey(registry: KairoRegistry): string {
        return this.createKey(registry.addonId, registry.version);
    }

    private indexAddonVersion(registry: KairoRegistry): void {
        const registries = this.byAddonId.get(registry.addonId) ?? [];
        registries.push(registry);
        registries.sort((a, b) => SemVerUtils.rcompare(a.version, b.version));
        this.byAddonId.set(registry.addonId, registries);
    }

    private indexDependents(registry: KairoRegistry): void {
        for (const dependencyAddonId of Object.keys(registry.dependencies)) {
            let set = this.dependents.get(dependencyAddonId);
            if (!set) {
                set = new Set<string>();
                this.dependents.set(dependencyAddonId, set);
            }
            set.add(registry.addonId);
        }
    }

    private createKey(addonId: string, version: SemVer): string {
        return `${addonId}@${SemVerUtils.format(version)}`;
    }
}
