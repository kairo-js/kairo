import type { KairoRegistry } from "@kairo-js/router";
import type {
    DependencyResolution,
    DependencyResolutionGraph,
    DependencyResolutionNode,
} from "./DependencyResolutionGraph";

export type DependencyKind = "dependencies" | "optionalDependencies" | "peerDependencies";

export interface DependencyEdge {
    readonly from: KairoRegistry;
    readonly to: KairoRegistry;
    readonly kind: DependencyKind;
}

export interface DependencyCycle {
    readonly edges: readonly DependencyEdge[];
}

export interface DependencyCycleResolverResult {
    readonly hardCycles: readonly DependencyCycle[];
    readonly optionalCycles: readonly DependencyCycle[];
    readonly peerCycles: readonly DependencyCycle[];
}

export class DependencyCycleResolver {
    resolve(graph: DependencyResolutionGraph): DependencyCycleResolverResult {
        const hardCycles: DependencyCycle[] = [];
        const optionalCycles: DependencyCycle[] = [];
        const peerCycles: DependencyCycle[] = [];

        for (const node of graph.getAll()) {
            this.visit(graph, node, [], new Set(), hardCycles, optionalCycles, peerCycles);
        }

        return {
            hardCycles,
            optionalCycles,
            peerCycles,
        };
    }

    private visit(
        graph: DependencyResolutionGraph,
        node: DependencyResolutionNode,
        stack: readonly DependencyEdge[],
        visiting: Set<string>,
        hardCycles: DependencyCycle[],
        optionalCycles: DependencyCycle[],
        peerCycles: DependencyCycle[],
    ): void {
        const currentId = node.graphNode.registry.kairoId;

        if (visiting.has(currentId)) {
            return;
        }

        visiting.add(currentId);

        this.visitDependencyKind(
            graph,
            node,
            node.dependencies,
            "dependencies",
            stack,
            visiting,
            hardCycles,
            optionalCycles,
            peerCycles,
        );

        this.visitDependencyKind(
            graph,
            node,
            node.optionalDependencies,
            "optionalDependencies",
            stack,
            visiting,
            hardCycles,
            optionalCycles,
            peerCycles,
        );

        this.visitDependencyKind(
            graph,
            node,
            node.peerDependencies,
            "peerDependencies",
            stack,
            visiting,
            hardCycles,
            optionalCycles,
            peerCycles,
        );

        visiting.delete(currentId);
    }

    private visitDependencyKind(
        graph: DependencyResolutionGraph,
        node: DependencyResolutionNode,
        resolutions: readonly DependencyResolution[],
        kind: DependencyKind,
        stack: readonly DependencyEdge[],
        visiting: Set<string>,
        hardCycles: DependencyCycle[],
        optionalCycles: DependencyCycle[],
        peerCycles: DependencyCycle[],
    ): void {
        for (const resolution of resolutions) {
            for (const target of resolution.resolved) {
                const edge: DependencyEdge = {
                    from: node.graphNode.registry,
                    to: target,
                    kind,
                };

                if (target.kairoId === node.graphNode.registry.kairoId) {
                    this.pushCycle(
                        {
                            edges: [...stack, edge],
                        },
                        kind,
                        hardCycles,
                        optionalCycles,
                        peerCycles,
                    );

                    continue;
                }

                const targetNode = graph.get(target.kairoId);

                if (!targetNode) {
                    continue;
                }

                const existingIndex = stack.findIndex((x) => x.from.kairoId === target.kairoId);

                if (existingIndex >= 0) {
                    const cycleEdges = [...stack.slice(existingIndex), edge];

                    this.pushCycle(
                        {
                            edges: cycleEdges,
                        },
                        kind,
                        hardCycles,
                        optionalCycles,
                        peerCycles,
                    );

                    continue;
                }

                this.visit(
                    graph,
                    targetNode,
                    [...stack, edge],
                    visiting,
                    hardCycles,
                    optionalCycles,
                    peerCycles,
                );
            }
        }
    }

    private pushCycle(
        cycle: DependencyCycle,
        kind: DependencyKind,
        hardCycles: DependencyCycle[],
        optionalCycles: DependencyCycle[],
        peerCycles: DependencyCycle[],
    ): void {
        switch (kind) {
            case "dependencies":
                hardCycles.push(cycle);
                return;

            case "optionalDependencies":
                optionalCycles.push(cycle);
                return;

            case "peerDependencies":
                peerCycles.push(cycle);
                return;
        }
    }
}
