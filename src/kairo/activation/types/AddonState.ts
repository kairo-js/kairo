import type { KairoRegistry } from "@kairo-js/router";

export type AddonState = "active" | "inactive" | "unresolved";
export type AddonInactiveReason = "user_disabled" | "dependency_conflict" | "peer_conflict";
export type AddonUnresolvedReason = "missing_dependency" | "missing_peer_dependency";

export interface AddonProblem {
    readonly addonId: string;
    readonly message: string;
}

export interface AddonStatus {
    readonly registry: KairoRegistry;
    readonly state: AddonState;
    readonly reasons: readonly string[];
    readonly problems: readonly AddonProblem[];
}
