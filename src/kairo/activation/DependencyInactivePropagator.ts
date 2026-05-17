import type { ActivationPlanningGraph } from "./ActivationPlanningGraph";

export class DependencyInactivePropagator {
    propagate(graph: ActivationPlanningGraph): void {
        let changed = true;

        while (changed) {
            changed = false;

            for (const node of graph.getAll()) {
                if (node.state === "inactive") {
                    continue;
                }

                if (node.state === "unresolved") {
                    continue;
                }

                const hasInactiveDependency = node.node.dependencies.some((dependency) =>
                    dependency.resolved.some((resolved) => {
                        const target = graph.get(resolved.kairoId);

                        if (!target) {
                            return false;
                        }

                        return target.state !== "active";
                    }),
                );

                if (!hasInactiveDependency) {
                    continue;
                }

                node.state = "inactive";
                node.reason = "dependency_inactive";

                changed = true;
            }
        }
    }
}
