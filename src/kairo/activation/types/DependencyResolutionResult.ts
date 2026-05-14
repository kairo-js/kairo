import type { KairoRegistry } from "@kairo-js/router";

export interface DependencyConflict {
    readonly addonId: string;
    readonly requestedRange: string;
    readonly existing: KairoRegistry;
    readonly requestedBy: KairoRegistry;
}

export interface MissingDependency {
    readonly addonId: string;
    readonly requestedRange: string;
    readonly requestedBy: KairoRegistry;
}

export interface DependencyResolutionResult {
    readonly registries: readonly KairoRegistry[];
    readonly conflicts: readonly DependencyConflict[];
    readonly missing: readonly MissingDependency[];
}
