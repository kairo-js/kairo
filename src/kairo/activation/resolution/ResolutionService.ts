import type { KairoRegistry } from "@kairo-js/router";
import { buildDeclaredGraph } from "./GraphBuilder";
import { detectCycles } from "./CycleDetector";
import { DependencyResolver } from "./DependencyResolver";
import { ConflictResolver } from "./ConflictResolver";
import { ActivationPlanner } from "./ActivationPlanner";
import { resetReasons } from "./ReasonResetService";
import type { ResolutionContext } from "../types/context";
import type { ActivationPlan } from "../types/plan";
import { AddonState, UnresolvedReasonCode, type AddonId, type KairoId } from "../types/state";
import type { KairoWorldState } from "../types/world";
import { setUnresolved } from "../helpers/RuntimeTransition";

export class ResolutionService {
    private readonly dependencyResolver = new DependencyResolver();
    private readonly conflictResolver = new ConflictResolver();
    private readonly planner = new ActivationPlanner();

    resolve(
        world: KairoWorldState,
        scope: ReadonlySet<KairoId>,
        ignoreManualBlock = false,
    ): ActivationPlan {
        // Step 0: reset resolution-generated reasons
        resetReasons(scope, world.runtimes);

        const scopeRegistries = this.scopedRegistries(scope, world.registries);

        // Step 1: build declared dependency graph (dependencies only, not optional)
        const declaredDependencyGraph = buildDeclaredGraph(scopeRegistries.values());

        // Step 2: cycle detection
        // Build a preliminary KairoId-level graph for cycle detection
        const prelimGraph = this.buildPrelimGraph(scope, declaredDependencyGraph, world);
        const { cyclicNodes } = detectCycles(prelimGraph);
        for (const kairoId of cyclicNodes) {
            const runtime = world.runtimes.get(kairoId);
            if (runtime) {
                setUnresolved(runtime, {
                    code: UnresolvedReasonCode.CIRCULAR_DEPENDENCY,
                    message: "Circular dependency detected",
                });
            }
        }

        // Step 3: resolve dependency specs to KairoIds
        const ctx: ResolutionContext = {
            scope,
            registries: world.registries,
            runtimes: world.runtimes,
            addonIdIndex: world.addonIdIndex,
            previousSession: world.previousSession,
            ignoreManualBlock,
            declaredDependencyGraph,
            dependencyGraph: new Map(),
            resolvedReverseDependencyGraph: new Map(),
            unresolvedQueue: [],
            conflictGroups: new Map(),
            activationPlan: { orderedKairoIds: [], resolvedReverseDependencyGraph: new Map() },
        };

        this.dependencyResolver.resolve(ctx);

        // Step 4: BFS propagation of UNRESOLVED
        this.propagateUnresolved(ctx);

        // Step 5: detect addonId conflicts
        this.detectConflicts(scope, world, ctx);

        // Step 6: resolve conflicts
        this.conflictResolver.resolve(ctx);

        // Step 7: build activation plan
        const scopeRuntimes = new Map<KairoId, typeof world.runtimes extends ReadonlyMap<KairoId, infer V> ? V : never>();
        for (const id of scope) {
            const rt = world.runtimes.get(id);
            if (rt) scopeRuntimes.set(id, rt);
        }

        const plan = this.planner.buildPlan(
            scopeRuntimes,
            world.runtimes,
            ctx.dependencyGraph,
            ctx.resolvedReverseDependencyGraph,
            world.previousSession,
            ignoreManualBlock,
        );

        return plan;
    }

    private buildPrelimGraph(
        scope: ReadonlySet<KairoId>,
        declaredGraph: Map<KairoId, Set<import("../types/state").AddonDependencySpec>>,
        world: KairoWorldState,
    ): Map<KairoId, Set<KairoId>> {
        const graph = new Map<KairoId, Set<KairoId>>();

        for (const kairoId of scope) {
            const specs = declaredGraph.get(kairoId);
            if (!specs) {
                graph.set(kairoId, new Set());
                continue;
            }

            const deps = new Set<KairoId>();
            for (const spec of specs) {
                const candidates = world.addonIdIndex.get(spec.addonId);
                if (!candidates) continue;
                for (const cId of candidates) {
                    if (scope.has(cId)) deps.add(cId);
                }
            }
            graph.set(kairoId, deps);
        }

        return graph;
    }

    private propagateUnresolved(ctx: ResolutionContext): void {
        const queue = [...ctx.unresolvedQueue];

        while (queue.length > 0) {
            const kairoId = queue.shift()!;
            const dependents = ctx.resolvedReverseDependencyGraph.get(kairoId);
            if (!dependents) continue;

            for (const depId of dependents) {
                if (!ctx.scope.has(depId)) continue;
                const runtime = ctx.runtimes.get(depId);
                if (!runtime || runtime.state === AddonState.UNRESOLVED) continue;

                setUnresolved(runtime, {
                    code: UnresolvedReasonCode.DEPENDENCY_UNRESOLVED,
                    message: `Dependency ${kairoId} is unresolved`,
                    related: [kairoId],
                });
                queue.push(depId);
            }
        }
    }

    private detectConflicts(
        scope: ReadonlySet<KairoId>,
        world: KairoWorldState,
        ctx: ResolutionContext,
    ): void {
        const groups = new Map<AddonId, Set<KairoId>>();

        for (const kairoId of scope) {
            const registry = world.registries.get(kairoId);
            if (!registry) continue;

            let group = groups.get(registry.addonId);
            if (!group) {
                group = new Set();
                groups.set(registry.addonId, group);
            }
            group.add(kairoId);
        }

        for (const [addonId, group] of groups) {
            if (group.size > 1) ctx.conflictGroups.set(addonId, group);
        }
    }

    private scopedRegistries(
        scope: ReadonlySet<KairoId>,
        registries: ReadonlyMap<KairoId, KairoRegistry>,
    ): Map<KairoId, KairoRegistry> {
        const result = new Map<KairoId, KairoRegistry>();
        for (const id of scope) {
            const r = registries.get(id);
            if (r) result.set(id, r);
        }
        return result;
    }
}
