import type { KairoRegistry } from "@kairo-js/router";

export type AddonStateStatus = "active" | "inactive" | "unresolved";

export interface AddonStateEntry {
    readonly registry: KairoRegistry;
    readonly status: AddonStateStatus;
    readonly reason?: string;
}

export class ActivationState {
    private readonly entries = new Map<string, AddonStateEntry>();

    set(registry: KairoRegistry, status: AddonStateStatus, reason?: string): void {
        this.entries.set(registry.kairoId, {
            registry,
            status,
            reason,
        });
    }

    get(kairoId: string): AddonStateEntry | undefined {
        return this.entries.get(kairoId);
    }

    isActive(kairoId: string): boolean {
        return this.entries.get(kairoId)?.status === "active";
    }

    getAll(): readonly AddonStateEntry[] {
        return [...this.entries.values()];
    }

    getActive(): readonly AddonStateEntry[] {
        return this.getAll().filter((entry) => entry.status === "active");
    }

    getInactive(): readonly AddonStateEntry[] {
        return this.getAll().filter((entry) => entry.status === "inactive");
    }

    getUnresolved(): readonly AddonStateEntry[] {
        return this.getAll().filter((entry) => entry.status === "unresolved");
    }
}
