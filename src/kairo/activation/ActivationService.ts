import type { ActivationExecutor } from "./ActivationExecutor";
import type { OptionalActivator } from "./OptionalActivator";
import { applyActivationOutcome } from "./helpers/ApplyOutcome";
import { setActive } from "./helpers/RuntimeTransition";
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
            if (context.blockedKairoIds.has(kairoId)) continue;

            // Optional activation may have already activated this addon
            if (world.runtimes.get(kairoId)?.state === AddonState.ACTIVE) continue;

            // Set ACTIVE optimistically before sending the request so that
            // addonActivate handlers in the guest can already call APIs targeting this addon.
            // applyActivationOutcome will roll back to INACTIVE if activation fails.
            const rt = world.runtimes.get(kairoId);
            if (rt) setActive(rt);

            const outcome = await this.executor.activate(kairoId);

            applyActivationOutcome(
                kairoId,
                outcome,
                world.runtimes,
                plan.resolvedReverseDependencyGraph,
                context.blockedKairoIds,
            );

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
