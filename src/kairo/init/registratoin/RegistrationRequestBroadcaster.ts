import { toError } from "@kairo-js/utils";
import type { KairoRuntime } from "../../../minecraft/KairoRuntime";
import { KairoInitEventId } from "../constants/KairoInitEventId";
import {
    RegistrationRequestBroadcasterError,
    RegistrationRequestBroadcasterErrorReason,
} from "./request/errors";
import type { RegistrationRequest } from "./request/schema";
import { stringifyRegistrationRequest } from "./request/stringify";

export class RegistrationRequestBroadcaster {
    constructor() {}

    broadcast(approvals: string[], rejects: string[], runtime: KairoRuntime): void {
        const request: RegistrationRequest = {
            approvals,
            rejects,
            timestamp: runtime.currentTick(),
        };

        try {
            const requestStr = stringifyRegistrationRequest(request);

            runtime.send(KairoInitEventId.RegistrationRequest, requestStr);
        } catch (e: unknown) {
            throw new RegistrationRequestBroadcasterError(
                RegistrationRequestBroadcasterErrorReason.StringifyFailed,
                { cause: toError(e) },
            );
        }
    }
}
