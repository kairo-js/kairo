import type { Disposable } from "@kairo-js/router";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { AddonState } from "../activation/types/state";
import type { KairoWorldState } from "../activation/types/world";
import type { KairoRegistryWithManifest } from "../KairoRegistryIndex";
import { ApiPipelineCoordinator } from "./ApiPipelineCoordinator";
import { CallSnapshotResolver } from "./CallSnapshotResolver";
import type { KairoApiHookRegistry } from "./KairoApiHookRegistry";
import type { ApiManifest } from "../init/api/ApiManifestSchema";
import type {
    AddonId,
    BeforeHookFn,
    AfterHookFn,
    HookTable,
    HookTableEntry,
    KairoId,
    RollbackFn,
    RoutingTable,
} from "./types";

export class KairoApiPipeline implements Disposable {
    private coordinator?: ApiPipelineCoordinator;
    private world?: KairoWorldState;
    private readonly routingTable: Map<AddonId, Map<string, KairoId>> = new Map();
    private readonly hookTable: Map<string, HookTableEntry[]> = new Map();

    constructor(
        private readonly runtime: KairoRuntime,
        private readonly kairoHookRegistry: KairoApiHookRegistry,
        private readonly getKairoKairoId: () => KairoId,
    ) {}

    // Called after Registration finalized — builds tables and starts coordinator
    initialize(
        registriesWithManifests: ReadonlyArray<KairoRegistryWithManifest>,
        ownKairoId: KairoId,
    ): void {
        this.buildRoutingTable(registriesWithManifests);
        this.buildHookTable(registriesWithManifests, ownKairoId);

        const snapshotResolver = new CallSnapshotResolver(
            this.routingTable as RoutingTable,
            this.hookTable as HookTable,
        );

        this.coordinator = new ApiPipelineCoordinator(
            this.runtime,
            snapshotResolver,
            () => this.world!,
            this.getKairoKairoId,
        );
    }

    setWorld(world: KairoWorldState): void {
        this.world = world;
    }

    notifyAddonDeactivated(kairoId: KairoId): void {
        this.coordinator?.cancelPendingForAddon(kairoId);
    }

    enterSwitchingMode(): void {
        this.coordinator?.enterSwitchingMode();
    }

    exitSwitchingMode(): void {
        this.coordinator?.exitSwitchingMode();
    }

    dispose(): void {
        this.coordinator?.dispose();
        this.coordinator = undefined;
    }

    private buildRoutingTable(registries: ReadonlyArray<KairoRegistryWithManifest>): void {
        for (const { registry, manifest } of registries) {
            let apiMap = this.routingTable.get(registry.addonId);
            if (!apiMap) {
                apiMap = new Map();
                this.routingTable.set(registry.addonId, apiMap);
            }
            for (const api of manifest.apis) {
                apiMap.set(api.name, registry.kairoId);
            }
        }
    }

    private buildHookTable(
        registries: ReadonlyArray<KairoRegistryWithManifest>,
        ownKairoId: KairoId,
    ): void {
        let globalSequence = 0;

        // 1. Hooks from other addon registries (remote invocation via CrossAddonHookHandler)
        for (const { registry, manifest } of registries) {
            if (registry.kairoId === ownKairoId) continue;
            for (const hookMeta of manifest.hooks) {
                const key = `${hookMeta.targetAddonId}::${hookMeta.apiName}`;
                if (!this.hookTable.has(key)) this.hookTable.set(key, []);
                this.hookTable.get(key)!.push({
                    providerAddonId: registry.addonId,
                    providerKairoId: registry.kairoId,
                    priority: hookMeta.priority,
                    sequence: globalSequence++,
                    declarationSequence: hookMeta.declarationSequence,
                    phases: hookMeta.phases as ReadonlyArray<"before" | "after">,
                    modes: ["send", "request"],
                    hasRollback: hookMeta.hasRollback,
                    isKairoInternal: false,
                });
            }
        }

        // 2. Hooks from kairo.api.hook() (kairo-internal, non-fatal after)
        const allTargetAddonIds = new Set<string>();
        for (const { manifest } of registries) {
            for (const api of manifest.apis) {
                // We'll iterate hook registry entries for each API
            }
        }

        // Scan all registered APIs from routing table to inject kairo internal hooks
        for (const [addonId, apiMap] of this.routingTable) {
            for (const apiName of apiMap.keys()) {
                const entries = this.kairoHookRegistry.getEntriesFor(addonId, apiName);
                if (entries.length === 0) continue;
                const key = `${addonId}::${apiName}`;
                if (!this.hookTable.has(key)) this.hookTable.set(key, []);
                for (const entry of entries) {
                    this.hookTable.get(key)!.push({
                        ...entry,
                        sequence: globalSequence++,
                    });
                }
            }
        }

        // Sort each entry list by (priority asc, addonId asc, sequence asc)
        for (const [, entries] of this.hookTable) {
            entries.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                const cmp = a.providerAddonId.localeCompare(b.providerAddonId);
                if (cmp !== 0) return cmp;
                return a.sequence - b.sequence;
            });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private wrapBeforeFn(fn: (ctx: any) => Promise<void>): BeforeHookFn {
        return fn as BeforeHookFn;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private wrapAfterFn(fn: (ctx: any) => Promise<void>): AfterHookFn {
        return fn as AfterHookFn;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private wrapRollbackFn(fn: (ctx: any) => Promise<any>): RollbackFn {
        return fn as RollbackFn;
    }
}
