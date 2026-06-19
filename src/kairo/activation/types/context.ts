import type { KairoRegistry } from "@kairo-js/router";
import type { ActivationPlan, DeclaredDependencyGraph } from "./plan";
import type { AddonDependencySpec, AddonId, AddonRuntimeState, KairoId } from "./state";
import type { PreviousSessionStore } from "./world";

export type ResolutionContext = {
    readonly scope: ReadonlySet<KairoId>;
    readonly registries: ReadonlyMap<KairoId, KairoRegistry>;
    readonly runtimes: ReadonlyMap<KairoId, AddonRuntimeState>;
    readonly addonIdIndex: ReadonlyMap<AddonId, ReadonlySet<KairoId>>;
    readonly previousSession: PreviousSessionStore;
    readonly ignoreManualBlock: boolean;
    readonly preferredKairoId?: KairoId;

    declaredDependencyGraph: Map<KairoId, Set<AddonDependencySpec>>;
    dependencyGraph: Map<KairoId, Set<KairoId>>;
    resolvedReverseDependencyGraph: Map<KairoId, Set<KairoId>>;
    unresolvedQueue: KairoId[];
    conflictGroups: Map<AddonId, Set<KairoId>>;
    activationPlan: ActivationPlan;
};

export type ActivationOutcome =
    | { readonly type: "SUCCESS" }
    | { readonly type: "FAILED"; readonly reason?: string }
    | { readonly type: "TIMEOUT" };

export type ActivationContext = {
    blockedKairoIds: Set<KairoId>;
};

export type ActivationSession = {
    readonly plan: ActivationPlan;
    readonly optionalStack: Set<AddonId>;
    readonly context: ActivationContext;
};
