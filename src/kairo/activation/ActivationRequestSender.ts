import { toError } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { ActivationEventId } from "./constants/ActivationEventId";
import { ActivationRequestSenderError, ActivationRequestSenderErrorReason } from "./request/errors";
import type { ActivationRequest } from "./request/schema";
import { stringifyActivationRequest } from "./request/stringify";

export class ActivationRequestSender {
    constructor() {}

    send(kairoId: string, action: "activate" | "deactivate", runtime: KairoRuntime): void {
        const query: ActivationRequest = {
            action,
            timestamp: runtime.currentTick(),
        };

        try {
            const queryStr = stringifyActivationRequest(query);

            runtime.send(kairoId + ":" + ActivationEventId.ActivationRequest, queryStr);
        } catch (e: unknown) {
            throw new ActivationRequestSenderError(
                ActivationRequestSenderErrorReason.StringifyFailed,
                { cause: toError(e) },
            );
        }
    }
}
