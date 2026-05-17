import type { KairoRegistry } from "@kairo-js/router";
import type { DependencyGraphNode, ParsedDependency } from "./DependencyGraph";

export interface DependencyCandidate {
    readonly registry: KairoRegistry;
    readonly prereleaseOnly: boolean;
}

export type DependencyResolutionStatus = "resolved" | "inactive" | "unresolved";

export interface DependencyResolution {
    readonly dependency: ParsedDependency;
    readonly status: DependencyResolutionStatus;
    readonly candidates: readonly DependencyCandidate[];
    readonly resolved: readonly KairoRegistry[];
    readonly reason?: string;
}

export interface DependencyResolutionNode {
    readonly graphNode: DependencyGraphNode;
    readonly dependencies: readonly DependencyResolution[];
    readonly optionalDependencies: readonly DependencyResolution[];
    readonly peerDependencies: readonly DependencyResolution[];
}

export class DependencyResolutionGraph {
    private readonly nodes = new Map<string, DependencyResolutionNode>();

    add(node: DependencyResolutionNode): void {
        this.nodes.set(node.graphNode.registry.kairoId, node);
    }

    get(kairoId: string): DependencyResolutionNode | undefined {
        return this.nodes.get(kairoId);
    }

    getAll(): readonly DependencyResolutionNode[] {
        return [...this.nodes.values()];
    }
}
