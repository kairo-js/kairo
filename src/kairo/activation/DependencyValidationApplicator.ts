import type { ActivationState } from "../activation/ActivationState";
import type { DependencyCycleResolverResult } from "./DependencyCycleResolver";
import type { DependencyResolutionGraph } from "./DependencyResolutionGraph";

export class DependencyValidationApplicator {
    apply(
        graph: DependencyResolutionGraph,
        cycles: DependencyCycleResolverResult,
        activationState: ActivationState,
    ): void {
        this.applyUnresolvedDependencies(graph, activationState);

        this.applyHardCycles(cycles, activationState);
    }

    private applyUnresolvedDependencies(
        graph: DependencyResolutionGraph,
        activationState: ActivationState,
    ): void {
        for (const node of graph.getAll()) {
            for (const dependency of node.dependencies) {
                if (dependency.status !== "unresolved") {
                    continue;
                }

                activationState.set(node.graphNode.registry, "unresolved", "missing_dependency");
            }
        }
    }

    private applyHardCycles(
        cycles: DependencyCycleResolverResult,
        activationState: ActivationState,
    ): void {
        for (const cycle of cycles.hardCycles) {
            for (const edge of cycle.edges) {
                activationState.set(edge.from, "unresolved", "circular_dependency");
            }
        }
    }
}
