import type { KairoRegistry } from "@kairo-js/router";
import { SemVerUtils } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type { HandoffPayload } from "../handoff/HandoffPayload";
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
    UnresolvedReasonCode,
    type AddonDependencySpec,
    type AddonRuntimeState,
    type InactiveReasons,
    type UnresolvedReasons,
    type KairoId,
} from "./types/state";
import type { KairoWorldState, PreviousSessionStore } from "./types/world";

export type DisablePreview = {
    readonly cascadeVictims: readonly KairoId[];
};

export type ImplicitVersionSwitch = {
    readonly from: KairoId;
    readonly to: KairoId;
};

export type EnablePreview = {
    readonly plan: ActivationPlan;
    readonly toActivate: readonly KairoId[];
    readonly implicitVersionSwitches: readonly ImplicitVersionSwitch[];
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
        private readonly onAddonDeactivated?: (kairoId: KairoId) => void,
        private readonly onSessionChanged?: (session: PreviousSessionStore) => void,
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

    startupResolve(initialSession?: PreviousSessionStore): ActivationPlan {
        this._world = this.buildWorldState(initialSession);
        this._world.cachedDeclaredReverseGraph = this.buildReverseGraph(this._world);
        const scope = new Set<KairoId>();
        for (const kairoId of this._world.runtimes.keys()) {
            const registry = this._world.registries.get(kairoId);
            if (!registry) continue;
            if (this._world.previousSession.get(registry.addonId)?.disabled) continue;
            scope.add(kairoId);
        }
        const plan = this.resolutionService.resolve(this._world, scope);
        this._activationOrder = plan.orderedKairoIds;
        return plan;
    }

    async startupActivate(plan: ActivationPlan): Promise<void> {
        await this.activationService.activate(this.world, plan);
    }

    restoreFromHandoff(payload: HandoffPayload): void {
        const registries = new Map<KairoId, KairoRegistry>();
        const runtimes = new Map<KairoId, AddonRuntimeState>();
        const addonIdIndex = new Map<string, Set<KairoId>>();

        for (const entry of payload.registries) {
            const registry: KairoRegistry = {
                kairoId: entry.kairoId,
                addonId: entry.addonId,
                version: {
                    major: entry.version.ma,
                    minor: entry.version.mi,
                    patch: entry.version.p,
                    ...(entry.version.pre !== undefined ? { prerelease: entry.version.pre } : {}),
                },
                name: entry.name,
                description: entry.description,
                metadata: {
                    authors: [...entry.metadata.authors],
                    url: entry.metadata.url,
                    license: entry.metadata.license,
                },
                dependencies: { ...entry.dependencies },
                optionalDependencies: { ...entry.optionalDependencies },
                tags: [...entry.tags],
            };
            registries.set(entry.kairoId, registry);

            let group = addonIdIndex.get(entry.addonId);
            if (!group) { group = new Set(); addonIdIndex.set(entry.addonId, group); }
            group.add(entry.kairoId);
        }

        for (const rt of payload.runtimes) {
            const state =
                rt.state === "ACTIVE" ? AddonState.ACTIVE
                : rt.state === "INACTIVE" ? AddonState.INACTIVE
                : AddonState.UNRESOLVED;

            const inactiveReasons: InactiveReasons = new Map();
            for (const r of rt.inactiveReasons) {
                inactiveReasons.set(r.code as InactiveReasonCode, {
                    code: r.code as InactiveReasonCode,
                    message: r.message,
                    ...(r.related ? { related: r.related } : {}),
                });
            }
            const unresolvedReasons: UnresolvedReasons = new Map();
            for (const r of rt.unresolvedReasons) {
                unresolvedReasons.set(r.code as UnresolvedReasonCode, {
                    code: r.code as UnresolvedReasonCode,
                    message: r.message,
                    ...(r.related ? { related: r.related } : {}),
                });
            }

            runtimes.set(rt.kairoId, { kairoId: rt.kairoId, state, inactiveReasons, unresolvedReasons });
        }

        const previousSession: PreviousSessionStore = new Map();
        for (const [addonId, entry] of Object.entries(payload.previousSession)) {
            previousSession.set(addonId, {
                version: {
                    major: entry.v.ma,
                    minor: entry.v.mi,
                    patch: entry.v.p,
                    ...(entry.v.pre !== undefined ? { prerelease: entry.v.pre } : {}),
                },
                origin: entry.o,
                ...(entry.d ? { disabled: true } : {}),
            });
        }

        this._world = { registries, runtimes, addonIdIndex, previousSession };
        this._world.cachedDeclaredReverseGraph = this.buildReverseGraph(this._world);
        this._activationOrder = payload.activationOrder;
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

        // Snapshot active state before resolve to detect implicit version switches
        const preActiveIds = new Set<KairoId>();
        for (const [id, rt] of world.runtimes) {
            if (rt.state === AddonState.ACTIVE) preActiveIds.add(id);
        }

        const plan = this.resolutionService.resolve(world, scope, true);

        const toActivate = plan.orderedKairoIds.filter(id => {
            return world.runtimes.get(id)?.state === AddonState.INACTIVE;
        });

        // Detect implicit version switches: plan members that displaced a previously-ACTIVE version
        const implicitVersionSwitches: ImplicitVersionSwitch[] = [];
        for (const planId of plan.orderedKairoIds) {
            const planReg = world.registries.get(planId);
            if (!planReg) continue;
            const displaced = [...(world.addonIdIndex.get(planReg.addonId) ?? [])]
                .find(id => id !== planId && preActiveIds.has(id));
            if (displaced) implicitVersionSwitches.push({ from: displaced, to: planId });
        }

        return { plan, toActivate, implicitVersionSwitches };
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
                this.onAddonDeactivated?.(victimId);
            }
        }

        const success = await this.deactivationExecutor.deactivate(kairoId);
        const rt = world.runtimes.get(kairoId);
        if (rt && success) {
            setInactive(rt, {
                code: InactiveReasonCode.MANUALLY_DEACTIVATED,
                message: "Manually deactivated",
            });
            this.onAddonDeactivated?.(kairoId);
            const registry = world.registries.get(kairoId);
            if (registry) {
                world.previousSession.set(registry.addonId, {
                    version: registry.version,
                    origin: "explicit",
                    disabled: true,
                });
                this.onSessionChanged?.(world.previousSession);
            }
        }
    }

    async executeEnable(kairoId: KairoId, origin: "latest" | "explicit"): Promise<void> {
        const { plan, implicitVersionSwitches } = this.previewEnable(kairoId);
        await this.executeEnableWithPlan(kairoId, origin, plan, implicitVersionSwitches);
    }

    async executeEnableWithPlan(
        kairoId: KairoId,
        origin: "latest" | "explicit",
        plan: ActivationPlan,
        implicitVersionSwitches: readonly ImplicitVersionSwitch[],
    ): Promise<void> {
        const world = this.world;

        const registry = world.registries.get(kairoId);
        if (registry) {
            world.previousSession.set(registry.addonId, { version: registry.version, origin });
            this.onSessionChanged?.(world.previousSession);
        }

        // Deactivate displaced versions before activating the plan
        for (const { from: oldId } of implicitVersionSwitches) {
            const { cascadeVictims } = this.previewDisable(oldId);
            for (const victimId of cascadeVictims) {
                const victimRt = world.runtimes.get(victimId);
                if (!victimRt || victimRt.state !== AddonState.ACTIVE) continue;
                await this.deactivationExecutor.deactivate(victimId);
                setInactive(victimRt, {
                    code: InactiveReasonCode.CASCADE_DEACTIVATED,
                    message: `Dependency ${oldId} was switched`,
                    related: [oldId],
                });
                this.onAddonDeactivated?.(victimId);
            }
            // Still running in Minecraft despite in-memory INACTIVE state set by ConflictResolver
            await this.deactivationExecutor.deactivate(oldId);
            this.onAddonDeactivated?.(oldId);
        }

        await this.activationService.activate(world, plan);
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
            this.onAddonDeactivated?.(victimId);
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
        this.onAddonDeactivated?.(oldKairoId);

        // Update session before previewEnable so ConflictResolver picks the new version
        const newRegistry = world.registries.get(newKairoId);
        if (newRegistry) {
            world.previousSession.set(newRegistry.addonId, {
                version: newRegistry.version,
                origin: "explicit",
            });
            this.onSessionChanged?.(world.previousSession);
        }

        // Activate new version
        const { plan } = this.previewEnable(newKairoId);
        await this.activationService.activate(world, plan);
    }

    // ── kairo-specific ───────────────────────────────────────────

    saveKairoVersionPreference(kairoId: KairoId, origin: "latest" | "explicit"): void {
        const registry = this.world.registries.get(kairoId);
        if (!registry) return;
        this.world.previousSession.set(registry.addonId, {
            version: registry.version,
            origin,
        });
        this.onSessionChanged?.(this.world.previousSession);
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

    private buildWorldState(initialSession?: PreviousSessionStore): KairoWorldState {
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

        return { registries, runtimes, addonIdIndex, previousSession: initialSession ?? new Map() };
    }
}
