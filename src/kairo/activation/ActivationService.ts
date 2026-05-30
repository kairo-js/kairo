import type { ActivationExecutor } from "./ActivationExecutor";
import type { OptionalActivator } from "./OptionalActivator";
import { applyActivationOutcome } from "./helpers/ApplyOutcome";
import type { ActivationContext, ActivationSession } from "./types/context";
import type { ActivationPlan } from "./types/plan";
import { AddonState, type KairoId } from "./types/state";
import type { KairoWorldState } from "./types/world";

export class ActivationService {
    constructor(
        private readonly executor: ActivationExecutor,
        private readonly optionalActivator: OptionalActivator,
    ) {}

    async activate(world: KairoWorldState, plan: ActivationPlan): Promise<void> {
        const context: ActivationContext = { blockedKairoIds: new Set() };
        const session: ActivationSession = {
            plan,
            optionalStack: new Set(),
            context,
        };

        for (const kairoId of plan.orderedKairoIds) {
            if (context.blockedKairoIds.has(kairoId)) {
                const registry = world.registries.get(kairoId);
                const label = registry ? `${registry.addonId}@${registry.version.major}.${registry.version.minor}.${registry.version.patch}` : kairoId;
                console.warn(`[Kairo] SKIPPED (dependency failed): ${label}`);
                continue;
            }

            // Optional activation may have already activated this addon
            if (world.runtimes.get(kairoId)?.state === AddonState.ACTIVE) continue;

            const registry = world.registries.get(kairoId);
            const label = registry ? `${registry.addonId}@${registry.version.major}.${registry.version.minor}.${registry.version.patch}` : kairoId;
            console.log(`[Kairo] Activating: ${label}`);

            const outcome = await this.executor.activate(kairoId);

            applyActivationOutcome(
                kairoId,
                outcome,
                world.runtimes,
                plan.resolvedReverseDependencyGraph,
                context.blockedKairoIds,
            );

            if (outcome.type === "SUCCESS") {
                console.log(`[Kairo] Activated: ${label}`);
            } else if (outcome.type === "FAILED") {
                console.error(`[Kairo] FAILED: ${label} — ${outcome.reason ?? "unknown"}`);
            } else {
                console.error(`[Kairo] TIMEOUT: ${label}`);
            }

            if (outcome.type !== "SUCCESS") continue;

            await this.activateOptionalDependencies(kairoId, session, world);
        }
    }

    private async activateOptionalDependencies(
        kairoId: KairoId,
        session: ActivationSession,
        world: KairoWorldState,
    ): Promise<void> {
        const registry = world.registries.get(kairoId);
        if (!registry) return;

        for (const [optAddonId] of Object.entries(registry.optionalDependencies)) {
            const optKairoIds = world.addonIdIndex.get(optAddonId);
            if (!optKairoIds) continue;

            for (const optKairoId of optKairoIds) {
                const rt = world.runtimes.get(optKairoId);
                if (!rt || rt.state !== AddonState.INACTIVE) continue;

                const { outcomes, reverseGraph } = await this.optionalActivator.activateOptional(
                    optKairoId,
                    session,
                    world,
                );

                const optionalBlocked = new Set<KairoId>();
                for (const [id, optOutcome] of outcomes) {
                    applyActivationOutcome(id, optOutcome, world.runtimes, reverseGraph, optionalBlocked);
                }
            }
        }
    }
}
