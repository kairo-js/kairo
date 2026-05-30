import type { SemVer } from "@kairo-js/properties";
import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";

export interface KairoRegistryQueryable {
    hasAddonVersion(addonId: string, version: SemVer): boolean;
    getAddonVersion(addonId: string, version: SemVer): KairoRegistry | undefined;
    getAddonVersions(addonId: string): readonly KairoRegistry[];
    getLatestAddonVersion(addonId: string): KairoRegistry | undefined;
    getDependents(addonId: string): readonly KairoRegistry[];
    getAll(): readonly KairoRegistry[];
    createRegistryKey(registry: KairoRegistry): string;
}

export class KairoRegistryIndex implements KairoRegistryQueryable {
    private readonly byKey = new Map<string, KairoRegistry>();
    private readonly byAddonId = new Map<string, KairoRegistry[]>();
    private readonly dependents = new Map<string, Set<string>>();

    add(registry: KairoRegistry): void {
        const key = this.createRegistryKey(registry);

        if (this.byKey.has(key)) {
            throw new Error(`Registry already exists: ${key}`);
        }

        this.byKey.set(key, registry);
        this.indexByAddonId(registry);
        this.indexDependents(registry);
    }

    hasAddonVersion(addonId: string, version: SemVer): boolean {
        return this.byKey.has(this.createKey(addonId, version));
    }

    getAddonVersion(addonId: string, version: SemVer): KairoRegistry | undefined {
        return this.byKey.get(this.createKey(addonId, version));
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
