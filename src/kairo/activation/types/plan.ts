import type { AddonDependencySpec, KairoId } from "./state";

export type DeclaredDependencyGraph = ReadonlyMap<KairoId, ReadonlySet<AddonDependencySpec>>;

export type ActivationPlan = {
    readonly orderedKairoIds: readonly KairoId[];
    readonly resolvedReverseDependencyGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>;
};
