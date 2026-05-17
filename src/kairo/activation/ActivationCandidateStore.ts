import type { KairoRegistry } from "@kairo-js/router";

export interface ActivationPlanEntry {
    readonly registry: KairoRegistry;
    readonly state: "active" | "inactive" | "unresolved";
    readonly reason?: string;
}

export interface ActivationPlan {
    readonly entries: readonly ActivationPlanEntry[];
}

export interface ActivationCandidateSelection {
    readonly addonId: string;
    readonly selected: KairoRegistry;
}

export class ActivationCandidateStore {
    private readonly selected = new Map<string, ActivationCandidateSelection>();

    set(selection: ActivationCandidateSelection): void {
        this.selected.set(selection.addonId, selection);
    }

    get(addonId: string): ActivationCandidateSelection | undefined {
        return this.selected.get(addonId);
    }

    has(addonId: string): boolean {
        return this.selected.has(addonId);
    }

    getAll(): readonly ActivationCandidateSelection[] {
        return [...this.selected.values()];
    }
}
