import { SemVerUtils } from "@kairo-js/utils";
import { AddonState, InactiveReasonCode, UnresolvedReasonCode, type KairoId } from "../types/state";
import type { ResolutionContext } from "../types/context";
import { setInactive, setUnresolved } from "../helpers/RuntimeTransition";

export class DependencyResolver {
    resolve(ctx: ResolutionContext): void {
        for (const kairoId of ctx.scope) {
            const runtime = ctx.runtimes.get(kairoId);
            if (!runtime) continue;
            if (runtime.state === AddonState.UNRESOLVED) continue;

            const specs = ctx.declaredDependencyGraph.get(kairoId);
            if (!specs) continue;

            for (const spec of specs) {
                const candidates = ctx.addonIdIndex.get(spec.addonId);

                if (!candidates || candidates.size === 0) {
                    setUnresolved(runtime, {
                        code: UnresolvedReasonCode.DEPENDENCY_NOT_FOUND,
                        message: `Dependency "${spec.addonId}" not found`,
                        related: [spec.addonId],
                    });
                    ctx.unresolvedQueue.push(kairoId);
                    break;
                }

                const isRangePrerelease = spec.versionRange.includes("-");

                // Collect all matching KairoIds
                const stableMatches: KairoId[] = [];
                const prereleaseMatches: KairoId[] = [];

                for (const candidateId of candidates) {
                    const candidateRegistry = ctx.registries.get(candidateId);
                    if (!candidateRegistry) continue;

                    const satisfies = SemVerUtils.satisfies(candidateRegistry.version, spec.versionRange);
                    if (!satisfies) continue;

                    if (SemVerUtils.isPrerelease(candidateRegistry.version)) {
                        prereleaseMatches.push(candidateId);
                    } else {
                        stableMatches.push(candidateId);
                    }
                }

                const hasAnyMatch = stableMatches.length > 0 || prereleaseMatches.length > 0;

                if (!hasAnyMatch) {
                    setUnresolved(runtime, {
                        code: UnresolvedReasonCode.VERSION_NOT_SATISFIED,
                        message: `No version of "${spec.addonId}" satisfies "${spec.versionRange}"`,
                        related: [spec.addonId],
                    });
                    ctx.unresolvedQueue.push(kairoId);
                    break;
                }

                // prerelease-only when range is stable but only prereleases match
                if (!isRangePrerelease && stableMatches.length === 0) {
                    setInactive(runtime, {
                        code: InactiveReasonCode.PRERELEASE_ONLY,
                        message: `Only prerelease versions of "${spec.addonId}" satisfy "${spec.versionRange}"`,
                        related: [spec.addonId],
                    });
                    break;
                }

                const bestId = this.pickBestMatch(
                    spec.addonId,
                    isRangePrerelease || stableMatches.length === 0
                        ? prereleaseMatches
                        : stableMatches,
                    ctx,
                );

                const targetRuntime = ctx.runtimes.get(bestId);

                if (targetRuntime?.state === AddonState.UNRESOLVED) {
                    if (targetRuntime.unresolvedReasons.has(UnresolvedReasonCode.CIRCULAR_DEPENDENCY)) {
                        // skip 窶・Step 4 BFS will propagate DEPENDENCY_UNRESOLVED
                    } else {
                        setUnresolved(runtime, {
                            code: UnresolvedReasonCode.DEPENDENCY_UNRESOLVED,
                            message: `Dependency "${spec.addonId}" is unresolved`,
                            related: [bestId],
                        });
                        ctx.unresolvedQueue.push(kairoId);
                        break;
                    }
                } else if (!ctx.scope.has(bestId) && targetRuntime?.state === AddonState.INACTIVE) {
                    setInactive(runtime, {
                        code: InactiveReasonCode.DEPENDENCY_INACTIVE,
                        message: `Dependency "${spec.addonId}" is inactive`,
                        related: [bestId],
                    });
                    break;
                }

                // Add forward edge
                let deps = ctx.dependencyGraph.get(kairoId);
                if (!deps) {
                    deps = new Set();
                    ctx.dependencyGraph.set(kairoId, deps);
                }
                deps.add(bestId);

                // Add reverse edge only if target is in scope
                if (ctx.scope.has(bestId)) {
                    let revDeps = ctx.resolvedReverseDependencyGraph.get(bestId);
                    if (!revDeps) {
                        revDeps = new Set();
                        ctx.resolvedReverseDependencyGraph.set(bestId, revDeps);
                    }
                    revDeps.add(kairoId);
                }
            }
        }
    }

    private pickBestMatch(
        addonId: string,
        pool: readonly KairoId[],
        ctx: ResolutionContext,
    ): KairoId {
        const previous = ctx.previousSession.get(addonId);
        if (previous?.origin === "explicit") {
            const explicit = pool.find((id) => {
                const registry = ctx.registries.get(id);
                return registry ? SemVerUtils.equals(registry.version, previous.version) : false;
            });
            if (explicit) return explicit;
        }

        return pool.reduce((best, current) => {
            const bestReg = ctx.registries.get(best)!;
            const currentReg = ctx.registries.get(current)!;
            return SemVerUtils.compare(currentReg.version, bestReg.version) > 0 ? current : best;
        });
    }
}
