import type { KairoId } from "../types/state";

export type CycleResult = {
    readonly cyclicNodes: ReadonlySet<KairoId>;
};

// Tarjan's SCC 窶・nodes in SCCs of size >= 2, or self-loops, are cyclic
export function detectCycles(
    graph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
): CycleResult {
    const index = new Map<KairoId, number>();
    const lowlink = new Map<KairoId, number>();
    const onStack = new Set<KairoId>();
    const stack: KairoId[] = [];
    const cyclicNodes = new Set<KairoId>();
    let counter = 0;

    function strongconnect(v: KairoId): void {
        index.set(v, counter);
        lowlink.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);

        for (const w of graph.get(v) ?? []) {
            if (!index.has(w)) {
                strongconnect(w);
                lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
            } else if (onStack.has(w)) {
                lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
            }
        }

        if (lowlink.get(v) === index.get(v)) {
            const scc: KairoId[] = [];
            let w: KairoId;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                scc.push(w);
            } while (w !== v);

            const isCyclic =
                scc.length > 1 ||
                (scc.length === 1 && (graph.get(scc[0]!)?.has(scc[0]!) ?? false));

            if (isCyclic) {
                for (const node of scc) cyclicNodes.add(node);
            }
        }
    }

    for (const node of graph.keys()) {
        if (!index.has(node)) strongconnect(node);
    }

    return { cyclicNodes };
}
