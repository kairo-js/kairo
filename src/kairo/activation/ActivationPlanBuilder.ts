import type { ActivationPlan, ActivationPlanEntry } from "./ActivationCandidateStore";
import type { ActivationPlanningGraph } from "./ActivationPlanningGraph";

export class ActivationPlanBuilder {
    build(graph: ActivationPlanningGraph): ActivationPlan {
        const entries: ActivationPlanEntry[] = [];

        for (const node of graph.getAll()) {
            if (node.state === "pending") {
                throw new Error(
                    `Pending activation node detected: ${node.node.graphNode.registry.kairoId}`,
                );
            }

            entries.push({
                registry: node.node.graphNode.registry,
                state: node.state,
                reason: node.reason,
            });
        }

        return {
            entries,
        };
    }
}
