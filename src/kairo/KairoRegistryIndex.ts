import type { SemVer } from "@kairo-js/properties";
import type { KairoRegistry } from "@kairo-js/router";

export interface KairoRegistryQueryable {
    hasAddonVersion(addonId: string, version: SemVer): boolean;
}

export class KairoRegistryIndex implements KairoRegistryQueryable {
    private readonly byAddonVersion = new Map<string, KairoRegistry>();

    add(registry: KairoRegistry): void {
        const key = this.createKey(registry.addonId, registry.version);

        this.byAddonVersion.set(key, registry);

        console.log(
            `Added registry for addon ${registry.addonId} version ${registry.version.major}.${registry.version.minor}.${registry.version.patch}`,
        );
    }

    hasAddonVersion(addonId: string, version: SemVer): boolean {
        return this.byAddonVersion.has(this.createKey(addonId, version));
    }

    private createKey(addonId: string, version: SemVer): string {
        return `${addonId}@${version.major}.${version.minor}.${version.patch}`;
    }
}
