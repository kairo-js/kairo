import type { KairoRegistry } from "@kairo-js/router";

export type AddonState = "active" | "inactive" | "unresolved";

export type AddonInactiveReason =
    | "dependency_conflict"
    | "dependency_unresolved"
    | "dependency_inactive"
    | "user_disabled"
    | "activation_failed"
    | "dependency_activation_failed"
    | "activation_timeout";

export type AddonUnresolvedReason =
    | "missing_dependency"
    | "missing_peer_dependency"
    | "circular_dependency"
    | "self_dependency";

export interface AddonStateEntry {
    readonly registry: KairoRegistry;

    readonly state: AddonState;

    readonly reason?: AddonInactiveReason | AddonUnresolvedReason;
}

export class ActivationState {
    private readonly entries = new Map<string, AddonStateEntry>();

    set(
        registry: KairoRegistry,
        state: AddonState,
        reason?: AddonInactiveReason | AddonUnresolvedReason,
    ): void {
        this.entries.set(registry.kairoId, {
            registry,
            state,
            reason,
        });

        console.log(`Addon ${registry.addonId} is now ${state}${reason ? ` (${reason})` : ""}`);
    }

    get(kairoId: string): AddonStateEntry | undefined {
        return this.entries.get(kairoId);
    }

    isActive(kairoId: string): boolean {
        return this.entries.get(kairoId)?.state === "active";
    }

    isInactive(kairoId: string): boolean {
        return this.entries.get(kairoId)?.state === "inactive";
    }

    isUnresolved(kairoId: string): boolean {
        return this.entries.get(kairoId)?.state === "unresolved";
    }

    getAll(): readonly AddonStateEntry[] {
        return [...this.entries.values()];
    }

    getActive(): readonly AddonStateEntry[] {
        return this.getAll().filter((x) => x.state === "active");
    }

    getInactive(): readonly AddonStateEntry[] {
        return this.getAll().filter((x) => x.state === "inactive");
    }

    getUnresolved(): readonly AddonStateEntry[] {
        return this.getAll().filter((x) => x.state === "unresolved");
    }
}
