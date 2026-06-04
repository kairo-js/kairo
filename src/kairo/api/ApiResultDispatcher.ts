import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { ApiEventId } from "./ApiEventId";
import type { ApiResult, ApiResultErrorType } from "./protocol/schema";
import type { KairoId } from "./types";

export class ApiResultDispatcher {
    constructor(private readonly runtime: KairoRuntime) {}

    sendSuccess(correlationId: string, result: unknown): void {
        let resultStr: string;
        try {
            resultStr = JSON.stringify(result);
        } catch {
            this.sendError(correlationId, "HANDLER_EXECUTION", "Result is not JSON serializable");
            return;
        }
        const msg: ApiResult = {
            correlationId,
            success: true,
            result: resultStr,
            timestamp: this.runtime.currentTick(),
        };
        this.dispatch(correlationId, msg);
    }

    sendCanceled(
        correlationId: string,
        reason: "ADDON_NOT_FOUND" | "ADDON_INACTIVE" | "ADDON_UNRESOLVED" | "CANCELED_BY_HOOK",
    ): void {
        const msg: ApiResult = {
            correlationId,
            success: false,
            canceled: true,
            reason,
            timestamp: this.runtime.currentTick(),
        };
        this.dispatch(correlationId, msg);
    }

    sendSwitching(correlationId: string): void {
        this.sendError(correlationId, "HOST_SWITCHING");
    }

    sendError(correlationId: string, errorType: ApiResultErrorType, error?: string): void {
        const msg: ApiResult = {
            correlationId,
            success: false,
            errorType,
            error,
            timestamp: this.runtime.currentTick(),
        };
        this.dispatch(correlationId, msg);
    }

    private dispatch(correlationId: string, msg: ApiResult): void {
        try {
            this.runtime.send(ApiEventId.apiResult(correlationId), JSON.stringify(msg));
        } catch {
            // send failure is silently ignored
        }
    }
}
