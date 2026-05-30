import { SemVerUtils } from "@kairo-js/utils";
import type { ResolutionContext } from "../types/context";
import { AddonState, InactiveReasonCode, type KairoId } from "../types/state";
import { setInactive } from "../helpers/RuntimeTransition";

export class ConflictResolver {
    resolve(ctx: ResolutionContext): void {
        for (const [, group] of ctx.conflictGroups) {
            if (group.size <= 1) continue;

            // Normalize: if multiple ACTIVE (invariant violation), keep kairoId-alpha winner
            const activeInGroup = [...group].filter(id => ctx.runtimes.get(id)?.state === AddonState.ACTIVE);
            if (activeInGroup.length > 1) {
                const [, ...losers] = activeInGroup.sort();
                for (const loser of losers) {
                    const rt = ctx.runtimes.get(loser);
                    if (rt) setInactive(rt, { code: InactiveReasonCode.CASCADE_DEACTIVATED, message: "Invariant: multiple ACTIVE for same addonId" });
                }
            }

            const winner = this.pickWinner(group, ctx);

            for (const id of group) {
                if (id === winner) continue;
                const rt = ctx.runtimes.get(id);
                if (!rt) continue;
                setInactive(rt, {
                    code: InactiveReasonCode.ADDON_ID_CONFLICT,
                    message: `Conflict: another version of the same addon is selected as winner`,
                    related: [winner],
                });
            }
        }
    }

    private pickWinner(group: Set<KairoId>, ctx: ResolutionContext): KairoId {
        const ids = [...group];

        // Priority 1: previous session explicit version
        for (const id of ids) {
            const registry = ctx.registries.get(id);
            if (!registry) continue;
            const prev = ctx.previousSession.get(registry.addonId);
            if (prev?.origin === "explicit" && SemVerUtils.equals(prev.version, registry.version)) {
                return id;
            }
        }

        // Priority 2: previous session latest-origin 竊・use current latest
        const anyLatest = ids.find(id => {
            const registry = ctx.registries.get(id);
            if (!registry) return false;
            return ctx.previousSession.get(registry.addonId)?.origin === "latest";
        });
        if (anyLatest !== undefined) {
            const addonId = ctx.registries.get(anyLatest)!.addonId;
            return this.latestVersionId(ids, addonId, ctx);
        }

        // Priority 3: no previous session 竊・latest
        if (ids.length > 0) {
            const addonId = ctx.registries.get(ids[0]!)!.addonId;
            return this.latestVersionId(ids, addonId, ctx);
        }

        // Priority 4: kairoId lexicographic (deterministic fallback)
        return [...ids].sort()[0]!;
    }

    private latestVersionId(ids: KairoId[], addonId: string, ctx: ResolutionContext): KairoId {
        const stable = ids.filter(id => {
            const r = ctx.registries.get(id);
            return r?.addonId === addonId && !SemVerUtils.isPrerelease(r.version);
        });
        const pool = stable.length > 0 ? stable : ids;

        return pool.reduce((best, current) => {
            const bestReg = ctx.registries.get(best)!;
            const currentReg = ctx.registries.get(current)!;
            return SemVerUtils.compare(currentReg.version, bestReg.version) > 0 ? current : best;
        });
    }
}
