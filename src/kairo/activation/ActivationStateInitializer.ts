import type { ActivationPlanningGraph } from "./ActivationPlanningGraph";

export class ActivationStateInitializer {
    initialize(graph: ActivationPlanningGraph): void {
        for (const node of graph.getAll()) {
            if (node.state !== "pending") {
                continue;
            }

            const hasUnresolved = node.node.dependencies.some(
                (dependency) => dependency.status === "unresolved",
            );

            if (hasUnresolved) {
                node.state = "unresolved";

                node.reason = "missing_dependency";

                continue;
            }

            const hasInactive = node.node.dependencies.some(
                (dependency) => dependency.status === "inactive",
            );

            if (hasInactive) {
                node.state = "inactive";

                node.reason = "dependency_conflict";

                continue;
            }

            node.state = "active";
        }
    }
}
