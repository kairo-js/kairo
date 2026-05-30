import type { ActivationOutcome } from "../types/context";
import type { AddonRuntimeState, KairoId } from "../types/state";
import { InactiveReasonCode } from "../types/state";
import { markBlockedDependents } from "./BlockedDependents";
import { setActive, setInactive } from "./RuntimeTransition";

export function applyActivationOutcome(
    kairoId: KairoId,
    outcome: ActivationOutcome,
    runtimes: ReadonlyMap<KairoId, AddonRuntimeState>,
    reverseGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
    blockedKairoIds: Set<KairoId>,
): void {
    const runtime = runtimes.get(kairoId);
    if (!runtime) return;

    if (outcome.type === "SUCCESS") {
        setActive(runtime);
        return;
    }

    if (outcome.type === "FAILED") {
        setInactive(runtime, {
            code: InactiveReasonCode.ACTIVATION_FAILED,
            message: outcome.reason ?? "Activation failed",
        });
    } else {
        setInactive(runtime, {
            code: InactiveReasonCode.ACTIVATION_TIMEOUT,
            message: "Activation timed out",
        });
    }

    markBlockedDependents(kairoId, reverseGraph, runtimes, blockedKairoIds);
}
