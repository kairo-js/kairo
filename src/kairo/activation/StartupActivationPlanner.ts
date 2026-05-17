import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import { ActivationCandidateStore, type ActivationPlan } from "./ActivationCandidateStore";
import { ActivationConflictPlanner } from "./ActivationConflictPlanner";
import { ActivationPlanBuilder } from "./ActivationPlanBuilder";
import { ActivationPlanningGraph } from "./ActivationPlanningGraph";
import { ActivationStateInitializer } from "./ActivationStateInitializer";
import { DependencyCycleResolver, type DependencyCycle } from "./DependencyCycleResolver";
import { DependencyGraphBuilder } from "./DependencyGraphBuilder";
import { DependencyInactivePropagator } from "./DependencyInactivePropagator";
import { DependencyRequirementResolver } from "./DependencyRequirementResolver";
import { VersionEvaluator } from "./VersionEvaluator";
import { VersionParser } from "./VersionParser";

export interface StartupActivationPlannerOptions {
    readonly includePrerelease?: boolean;
}

export class StartupActivationPlanner {
    private readonly versionParser = new VersionParser();

    private readonly versionEvaluator = new VersionEvaluator();

    private readonly dependencyGraphBuilder: DependencyGraphBuilder;

    private readonly dependencyRequirementResolver: DependencyRequirementResolver;

    private readonly dependencyCycleResolver = new DependencyCycleResolver();

    private readonly activationStateInitializer = new ActivationStateInitializer();

    private readonly activationConflictPlanner = new ActivationConflictPlanner();

    private readonly dependencyInactivePropagator = new DependencyInactivePropagator();

    private readonly activationPlanBuilder = new ActivationPlanBuilder();

    constructor(private readonly registryIndex: KairoRegistryQueryable) {
        this.dependencyGraphBuilder = new DependencyGraphBuilder(registryIndex, this.versionParser);

        this.dependencyRequirementResolver = new DependencyRequirementResolver(
            registryIndex,
            this.versionEvaluator,
        );
    }

    createPlan(options?: StartupActivationPlannerOptions): ActivationPlan {
        const dependencyGraph = this.dependencyGraphBuilder.build();

        const resolutionGraph = this.dependencyRequirementResolver.resolve(dependencyGraph, {
            includePrerelease: options?.includePrerelease,
        });

        const cycles = this.dependencyCycleResolver.resolve(resolutionGraph);

        const planningGraph = new ActivationPlanningGraph(resolutionGraph);

        this.applyCycles(planningGraph, cycles.hardCycles);

        this.activationStateInitializer.initialize(planningGraph);

        const candidates = new ActivationCandidateStore();

        this.activationConflictPlanner.apply(planningGraph, candidates);

        this.dependencyInactivePropagator.propagate(planningGraph);

        return this.activationPlanBuilder.build(planningGraph);
    }

    private applyCycles(graph: ActivationPlanningGraph, cycles: readonly DependencyCycle[]): void {
        for (const cycle of cycles) {
            for (const edge of cycle.edges) {
                const node = graph.get(edge.from.kairoId);

                if (!node) {
                    continue;
                }

                node.state = "unresolved";

                node.reason = "circular_dependency";
            }
        }
    }
}
