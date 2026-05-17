import type {
    DependencyResolutionGraph,
    DependencyResolutionNode,
} from "./DependencyResolutionGraph";

export interface ActivationPlanningNode {
    readonly node: DependencyResolutionNode;
    state: "pending" | "active" | "inactive" | "unresolved";
    reason?: string;
}

export class ActivationPlanningGraph {
    private readonly nodes = new Map<string, ActivationPlanningNode>();

    constructor(graph: DependencyResolutionGraph) {
        for (const node of graph.getAll()) {
            this.nodes.set(node.graphNode.registry.kairoId, {
                node,
                state: "pending",
            });
        }
    }

    get(kairoId: string): ActivationPlanningNode | undefined {
        return this.nodes.get(kairoId);
    }

    getAll(): readonly ActivationPlanningNode[] {
        return [...this.nodes.values()];
    }
}
