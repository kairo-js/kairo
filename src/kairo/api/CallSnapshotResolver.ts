import { AddonState } from "../activation/types/state";
import type { KairoWorldState } from "../activation/types/world";
import type {
    AddonId,
    HookTable,
    KairoId,
    ResolvedCallSnapshot,
    ResolvedHook,
    ResolvedHookChain,
    RoutingError,
    RoutingTable,
} from "./types";

export class CallSnapshotResolver {
    constructor(
        private readonly routingTable: RoutingTable,
        private readonly hookTable: HookTable,
    ) {}

    resolve(
        targetAddonId: AddonId,
        apiName: string,
        callerAddonId: AddonId,
        world: KairoWorldState,
    ): ResolvedCallSnapshot | RoutingError {
        // Step 3: routing check
        const apiMap = this.routingTable.get(targetAddonId);
        if (!apiMap) {
            return { kind: "ADDON_NOT_FOUND" };
        }

        const targetKairoId = apiMap.get(apiName);
        if (!targetKairoId) {
            // Check if the addon exists (for API_NOT_FOUND vs ADDON_*)
            const addonActive = this.isAddonActive(targetAddonId, world);
            if (addonActive === "not_found") return { kind: "ADDON_NOT_FOUND" };
            if (addonActive === "inactive") return { kind: "ADDON_INACTIVE" };
            if (addonActive === "unresolved") return { kind: "ADDON_UNRESOLVED" };
            return { kind: "API_NOT_FOUND" };
        }

        const rt = world.runtimes.get(targetKairoId);
        if (!rt) return { kind: "ADDON_NOT_FOUND" };
        if (rt.state === AddonState.INACTIVE) return { kind: "ADDON_INACTIVE" };
        if (rt.state === AddonState.UNRESOLVED) return { kind: "ADDON_UNRESOLVED" };

        // Step 3: hook snapshot — check activation state of each hook provider
        const hookKey = `${targetAddonId}::${apiName}`;
        const rawHooks = this.hookTable.get(hookKey) ?? [];

        const activeHooks: ResolvedHook[] = rawHooks
            .filter((h) => {
                if (h.isKairoInternal) return true;
                const providerRt = world.runtimes.get(h.providerKairoId);
                return providerRt?.state === AddonState.ACTIVE;
            })
            .map((h) => ({
                addonId: h.providerAddonId,
                providerKairoId: h.providerKairoId,
                sequence: h.sequence,
                declarationSequence: h.declarationSequence,
                phases: h.phases,
                modes: h.modes,
                hasRollback: h.hasRollback,
                beforeFn: h.beforeFn,
                afterFn: h.afterFn,
                rollbackFn: h.rollbackFn,
                isKairoInternal: h.isKairoInternal,
            }));

        // Sort: priority asc → addonId asc → sequence asc
        activeHooks.sort((a, b) => {
            const pa = this.hookPriority(rawHooks, a);
            const pb = this.hookPriority(rawHooks, b);
            if (pa !== pb) return pa - pb;
            const addonCmp = a.addonId.localeCompare(b.addonId);
            if (addonCmp !== 0) return addonCmp;
            return a.sequence - b.sequence;
        });

        const beforeChain = activeHooks.filter((h) => !!h.beforeFn || h.phases.includes("before"));
        const afterChain = [...activeHooks].reverse().filter((h) => !!h.afterFn || h.phases.includes("after"));

        const hookChain: ResolvedHookChain = {
            before: beforeChain,
            after: afterChain,
        };

        return {
            targetKairoId,
            callerAddonId,
            hookChain,
        };
    }

    private hookPriority(rawHooks: ReadonlyArray<{ providerAddonId: string; sequence: number; priority: number }>, hook: ResolvedHook): number {
        const raw = rawHooks.find(
            (h) => h.providerAddonId === hook.addonId && h.sequence === hook.sequence,
        );
        return raw?.priority ?? 0;
    }

    private isAddonActive(
        addonId: AddonId,
        world: KairoWorldState,
    ): "active" | "inactive" | "unresolved" | "not_found" {
        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds || kairoIds.size === 0) return "not_found";

        for (const id of kairoIds) {
            const rt = world.runtimes.get(id);
            if (rt?.state === AddonState.ACTIVE) return "active";
        }

        for (const id of kairoIds) {
            const rt = world.runtimes.get(id);
            if (rt?.state === AddonState.INACTIVE) return "inactive";
        }

        return "unresolved";
    }
}
