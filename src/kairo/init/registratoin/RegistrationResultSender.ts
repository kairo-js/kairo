import { toError } from "@kairo-js/utils";
import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import { KairoInitEventId } from "../constants/KairoInitEventId";
import type { KairoRegistryRejectReason } from "../KairoRegistryVerifier";
import {
    RegistrationResultSenderError,
    RegistrationResultSenderErrorReason,
} from "./result/errors";
import type { RegistrationResult } from "./result/schema";
import { stringifyRegistrationResult } from "./result/stringify";

export class RegistrationResultSender {
    constructor() {}

    send(
        kairoId: string,
        result: { success: boolean; reason?: KairoRegistryRejectReason },
        runtime: KairoRuntime,
    ): void {
        const registrationResult: RegistrationResult = {
            kairoId,
            success: result.success,
            reason: result.reason,
            timestamp: runtime.currentTick(),
        };

        try {
            const registrationResultStr = stringifyRegistrationResult(registrationResult);

            runtime.send(KairoInitEventId.RegistrationResult, registrationResultStr);
        } catch (e: unknown) {
            throw new RegistrationResultSenderError(
                RegistrationResultSenderErrorReason.StringifyFailed,
                { cause: toError(e) },
            );
        }
    }
}
