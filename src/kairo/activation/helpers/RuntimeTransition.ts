import { AddonState, InactiveReasonCode, type AddonRuntimeState, type InactiveReasonItem, type UnresolvedReasonItem } from "../types/state";

export function setActive(runtime: AddonRuntimeState): void {
    runtime.state = AddonState.ACTIVE;
    runtime.inactiveReasons.delete(InactiveReasonCode.ACTIVATION_FAILED);
    runtime.inactiveReasons.delete(InactiveReasonCode.DEPENDENCY_INACTIVE);
    runtime.inactiveReasons.delete(InactiveReasonCode.CASCADE_DEACTIVATED);
    runtime.inactiveReasons.delete(InactiveReasonCode.MANUALLY_DEACTIVATED);
    // ACTIVATION_TIMEOUT is NOT removed here — only cleanup command removes it
}

export function setInactive(runtime: AddonRuntimeState, reason: InactiveReasonItem): void {
    runtime.state = AddonState.INACTIVE;
    runtime.unresolvedReasons.clear();
    runtime.inactiveReasons.set(reason.code, reason);
}

export function setUnresolved(runtime: AddonRuntimeState, reason: UnresolvedReasonItem): void {
    runtime.state = AddonState.UNRESOLVED;
    runtime.inactiveReasons.clear();
    runtime.unresolvedReasons.set(reason.code, reason);
}
