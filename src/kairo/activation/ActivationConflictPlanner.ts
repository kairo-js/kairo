import type { ActivationCandidateStore } from "./ActivationCandidateStore";
import type { ActivationPlanningGraph, ActivationPlanningNode } from "./ActivationPlanningGraph";

export class ActivationConflictPlanner {
    apply(graph: ActivationPlanningGraph, candidates: ActivationCandidateStore): void {
        const grouped = new Map<string, ActivationPlanningNode[]>();

        for (const node of graph.getAll()) {
            const addonId = node.node.graphNode.registry.addonId;

            let array = grouped.get(addonId);

            if (!array) {
                array = [];

                grouped.set(addonId, array);
            }

            array.push(node);
        }

        for (const nodes of grouped.values()) {
            if (nodes.length <= 1) {
                continue;
            }

            const selected = this.selectNode(nodes);

            candidates.set({
                addonId: selected.node.graphNode.registry.addonId,
                selected: selected.node.graphNode.registry,
            });

            for (const node of nodes) {
                if (node === selected) {
                    continue;
                }

                if (node.state === "unresolved") {
                    continue;
                }

                node.state = "inactive";
                node.reason = "dependency_conflict";
            }
        }
    }

    private selectNode(nodes: readonly ActivationPlanningNode[]): ActivationPlanningNode {
        return [...nodes].sort(
            (a, b) =>
                b.node.graphNode.registry.version.major - a.node.graphNode.registry.version.major,
        )[0]!;
    }
}
