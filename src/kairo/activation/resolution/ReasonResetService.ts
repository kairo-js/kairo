import { AddonState, InactiveReasonCode, type AddonRuntimeState, type KairoId } from "../types/state";

export function resetReasons(
    scope: ReadonlySet<KairoId>,
    runtimes: ReadonlyMap<KairoId, AddonRuntimeState>,
): void {
    for (const kairoId of scope) {
        const runtime = runtimes.get(kairoId);
        if (!runtime) continue;

        if (runtime.state === AddonState.UNRESOLVED) {
            runtime.state = AddonState.INACTIVE;
            runtime.unresolvedReasons.clear();
        }

        runtime.inactiveReasons.delete(InactiveReasonCode.PRERELEASE_ONLY);
        runtime.inactiveReasons.delete(InactiveReasonCode.ADDON_ID_CONFLICT);
        runtime.inactiveReasons.delete(InactiveReasonCode.DEPENDENCY_INACTIVE);
    }
}
