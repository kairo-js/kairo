import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import { ActivationExecutor } from "./ActivationExecutor";
import { ActivationService } from "./ActivationService";
import { DeactivationExecutor } from "./DeactivationExecutor";
import { OptionalActivator } from "./OptionalActivator";
import { buildDependencyClosure } from "./resolution/DependencyClosureBuilder";
import { ResolutionService } from "./resolution/ResolutionService";
import { setInactive } from "./helpers/RuntimeTransition";
import { markBlockedDependents } from "./helpers/BlockedDependents";
import type { ActivationPlan } from "./types/plan";
import {
    AddonState,
    InactiveReasonCode,
    type AddonDependencySpec,
    type AddonRuntimeState,
    type KairoId,
} from "./types/state";
import type { KairoWorldState } from "./types/world";

export type DisablePreview = {
    readonly cascadeVictims: readonly KairoId[];
};

export type EnablePreview = {
    readonly plan: ActivationPlan;
    readonly toActivate: readonly KairoId[];
};

export type VersionSwitchPreview = {
    readonly cascadeVictims: readonly KairoId[];
    readonly continuingIds: readonly KairoId[];
};

export class ActivationController {
    private readonly resolutionService: ResolutionService;
    private readonly activationService: ActivationService;
    private readonly executor: ActivationExecutor;
    private readonly deactivationExecutor: DeactivationExecutor;
    private _world?: KairoWorldState;
    private _activationOrder: readonly KairoId[] = [];

    constructor(
        private readonly runtime: KairoRuntime,
        private readonly registryIndex: KairoRegistryQueryable,
    ) {
        this.executor = new ActivationExecutor(runtime);
        const optionalActivator = new OptionalActivator(this.executor);
        this.resolutionService = new ResolutionService();
        this.activationService = new ActivationService(this.executor, optionalActivator);
        this.deactivationExecutor = new DeactivationExecutor(this.executor);
    }

    get world(): KairoWorldState {
        if (!this._world) throw new Error("[Kairo] World not initialized");
        return this._world;
    }

    get activationOrder(): readonly KairoId[] {
        return this._activationOrder;
    }

    setup(): void {}

    startupResolve(): ActivationPlan {
        this._world = this.buildWorldState();
        this._world.cachedDeclaredReverseGraph = this.buildReverseGraph(this._world);
        console.log(`[Kairo] Resolution Phase: ${this._world.runtimes.size} addon(s) registered`);
        const scope = new Set<KairoId>(this._world.runtimes.keys());
        const plan = this.resolutionService.resolve(this._world, scope);
        this._activationOrder = plan.orderedKairoIds;
        console.log(`[Kairo] Resolution Phase complete: ${plan.orderedKairoIds.length} addon(s) scheduled for activation`);
        return plan;
    }

    async startupActivate(plan: ActivationPlan): Promise<void> {
        console.log(`[Kairo] Activation Phase: starting`);
        await this.activationService.activate(this.world, plan);
        console.log(`[Kairo] Activation Phase complete`);
    }

    // ── Preview methods ──────────────────────────────────────────

    previewDisable(kairoId: KairoId): DisablePreview {
        const reverseGraph = this.world.cachedDeclaredReverseGraph;
        if (!reverseGraph) return { cascadeVictims: [] };

        const victims: KairoId[] = [];
        const visited = new Set<KairoId>();
        const queue = [kairoId];

        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const depId of reverseGraph.get(current) ?? []) {
                if (visited.has(depId)) continue;
                visited.add(depId);
                if (this.world.runtimes.get(depId)?.state === AddonState.ACTIVE) {
                    victims.push(depId);
                    queue.push(depId);
                }
            }
        }

        return { cascadeVictims: victims };
    }

    previewEnable(kairoId: KairoId): EnablePreview {
        const world = this.world;
        const scope = this.buildManualActivateScope(kairoId);
        const plan = this.resolutionService.resolve(world, scope);

        const toActivate = plan.orderedKairoIds.filter(id => {
            return world.runtimes.get(id)?.state === AddonState.INACTIVE;
        });

        return { plan, toActivate };
    }

    previewVersionSwitch(newKairoId: KairoId): VersionSwitchPreview {
        const world = this.world;
        const newRegistry = world.registries.get(newKairoId);
        if (!newRegistry) return { cascadeVictims: [], continuingIds: [] };

        const currentActiveId = [...(world.addonIdIndex.get(newRegistry.addonId) ?? [])]
            .find(id => world.runtimes.get(id)?.state === AddonState.ACTIVE);

        if (!currentActiveId) return { cascadeVictims: [], continuingIds: [] };

        const reverseGraph = world.cachedDeclaredReverseGraph;
        const cascadeVictims: KairoId[] = [];
        const continuingIds: KairoId[] = [];

        for (const depId of reverseGraph?.get(currentActiveId) ?? []) {
            const rt = world.runtimes.get(depId);
            if (rt?.state !== AddonState.ACTIVE) continue;

            const depRegistry = world.registries.get(depId);
            if (!depRegistry) continue;

            const versionRange = depRegistry.dependencies[newRegistry.addonId];
            const compatible = versionRange
                ? SemVerUtils.satisfies(newRegistry.version, versionRange)
                : false;

            if (compatible) {
                continuingIds.push(depId);
            } else {
                cascadeVictims.push(depId);
            }
        }

        return { cascadeVictims, continuingIds };
    }

    // ── Execute methods ──────────────────────────────────────────

    async executeDisable(kairoId: KairoId): Promise<void> {
        const world = this.world;
        const registry = world.registries.get(kairoId);
        const label = registry ? `${registry.addonId}@${registry.version.major}.${registry.version.minor}.${registry.version.patch}` : kairoId;
        console.log(`[Kairo UI] Disabling: ${label}`);

        const { cascadeVictims } = this.previewDisable(kairoId);

        for (const victimId of cascadeVictims) {
            const rt = world.runtimes.get(victimId);
            if (!rt || rt.state !== AddonState.ACTIVE) continue;
            const success = await this.deactivationExecutor.deactivate(victimId);
            if (success) {
                setInactive(rt, {
                    code: InactiveReasonCode.CASCADE_DEACTIVATED,
                    message: `Dependency ${kairoId} was manually deactivated`,
                    related: [kairoId],
                });
            }
        }

        const success = await this.deactivationExecutor.deactivate(kairoId);
        console.log(`[Kairo UI] Deactivate result: ${success ? "success" : "failed"}`);
        const rt = world.runtimes.get(kairoId);
        if (rt && success) {
            setInactive(rt, {
                code: InactiveReasonCode.MANUALLY_DEACTIVATED,
                message: "Manually deactivated",
            });
            console.log(`[Kairo UI] Disabled: ${label}`);
        }
    }

    async executeEnable(kairoId: KairoId, origin: "latest" | "explicit"): Promise<void> {
        const world = this.world;
        const { plan } = this.previewEnable(kairoId);
        await this.activationService.activate(world, plan);

        // Update previousSession
        const registry = world.registries.get(kairoId);
        if (registry) {
            world.previousSession.set(registry.addonId, {
                version: registry.version,
                origin,
            });
        }
    }

    async executeVersionSwitch(oldKairoId: KairoId, newKairoId: KairoId): Promise<void> {
        const world = this.world;
        const { cascadeVictims } = this.previewVersionSwitch(newKairoId);

        // Cascade deactivate incompatible dependents
        for (const victimId of cascadeVictims) {
            const rt = world.runtimes.get(victimId);
            if (!rt || rt.state !== AddonState.ACTIVE) continue;
            await this.deactivationExecutor.deactivate(victimId);
            setInactive(rt, {
                code: InactiveReasonCode.CASCADE_DEACTIVATED,
                message: `Version switch on ${world.registries.get(oldKairoId)?.addonId}`,
                related: [oldKairoId],
            });
        }

        // Deactivate old version
        const oldSuccess = await this.deactivationExecutor.deactivate(oldKairoId);
        if (!oldSuccess) {
            // Abort — leave old as ACTIVE
            return;
        }
        const oldRt = world.runtimes.get(oldKairoId);
        if (oldRt) {
            setInactive(oldRt, {
                code: InactiveReasonCode.ADDON_ID_CONFLICT,
                message: "Superseded by version switch",
                related: [newKairoId],
            });
        }

        // Activate new version
        const { plan } = this.previewEnable(newKairoId);
        await this.activationService.activate(world, plan);
    }

    // ── Private helpers ──────────────────────────────────────────

    private buildManualActivateScope(kairoId: KairoId): ReadonlySet<KairoId> {
        const world = this.world;
        const versionMatcher = (spec: AddonDependencySpec, reg: KairoRegistry): boolean =>
            SemVerUtils.satisfies(reg.version, spec.versionRange);

        const closure = buildDependencyClosure(kairoId, world.registries, world.addonIdIndex, versionMatcher);
        const scope = new Set<KairoId>(closure);

        for (const closureId of closure) {
            const r = world.registries.get(closureId);
            if (!r) continue;
            const group = world.addonIdIndex.get(r.addonId);
            if (!group) continue;
            for (const gId of group) scope.add(gId);
            for (const gId of group) {
                if (world.runtimes.get(gId)?.state === AddonState.ACTIVE) scope.add(gId);
            }
        }

        return scope;
    }

    private buildReverseGraph(world: KairoWorldState): ReadonlyMap<KairoId, ReadonlySet<KairoId>> {
        const graph = new Map<KairoId, Set<KairoId>>();

        for (const [kairoId, registry] of world.registries) {
            for (const addonId of Object.keys(registry.dependencies)) {
                const targets = world.addonIdIndex.get(addonId) ?? new Set();
                for (const targetId of targets) {
                    let deps = graph.get(targetId);
                    if (!deps) { deps = new Set(); graph.set(targetId, deps); }
                    deps.add(kairoId);
                }
            }
        }

        return graph;
    }

    private buildWorldState(): KairoWorldState {
        const registries = new Map<KairoId, KairoRegistry>();
        const runtimes = new Map<KairoId, AddonRuntimeState>();
        const addonIdIndex = new Map<string, Set<KairoId>>();

        for (const registry of this.registryIndex.getAll()) {
            const kairoId = registry.kairoId;
            registries.set(kairoId, registry);
            runtimes.set(kairoId, {
                kairoId,
                state: AddonState.INACTIVE,
                inactiveReasons: new Map(),
                unresolvedReasons: new Map(),
            });

            let group = addonIdIndex.get(registry.addonId);
            if (!group) { group = new Set(); addonIdIndex.set(registry.addonId, group); }
            group.add(kairoId);
        }

        return { registries, runtimes, addonIdIndex, previousSession: new Map() };
    }
}
