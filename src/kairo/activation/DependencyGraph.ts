import type { KairoRegistry } from "@kairo-js/router";
import type { VersionExpression } from "./VersionParser";

export interface ParsedDependency {
    readonly addonId: string;
    readonly range: string;
    readonly expression: VersionExpression;
}

export interface DependencyGraphNode {
    readonly registry: KairoRegistry;
    readonly dependencies: readonly ParsedDependency[];
    readonly optionalDependencies: readonly ParsedDependency[];
    readonly peerDependencies: readonly ParsedDependency[];
}

export class DependencyGraph {
    private readonly nodes = new Map<string, DependencyGraphNode>();

    add(node: DependencyGraphNode): void {
        this.nodes.set(node.registry.kairoId, node);
    }

    get(kairoId: string): DependencyGraphNode | undefined {
        return this.nodes.get(kairoId);
    }

    getAll(): readonly DependencyGraphNode[] {
        return [...this.nodes.values()];
    }
}
