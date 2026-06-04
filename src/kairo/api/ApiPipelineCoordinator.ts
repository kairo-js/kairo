import type { Disposable } from "@kairo-js/router";
import { compile, safeJsonParse } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import type { KairoWorldState } from "../activation/types/world";
import { ApiEventId } from "./ApiEventId";
import { ApiResultDispatcher } from "./ApiResultDispatcher";
import { CallSnapshotResolver } from "./CallSnapshotResolver";
import { HookPhaseRunner } from "./HookPhaseRunner";
import { InvokeSender } from "./InvokeSender";
import { PendingRequestStore } from "./PendingRequestStore";
import { RemoteHookInvoker } from "./RemoteHookInvoker";
import { RollbackExecutor } from "./RollbackExecutor";
import {
    ApiCallSchema,
    ApiHandlerResponseSchema,
    type ApiCall,
    type ApiHandlerResponse,
} from "./protocol/schema";
import type { KairoId, PendingEntry, ResolvedHook, ResolvedHookChain } from "./types";

const DEFAULT_TIMEOUT_TICKS = 20;

type AfterChainEntry = {
    runner: HookPhaseRunner;
    afterChain: ReadonlyArray<ResolvedHook>;
    callerAddonId: string;
    apiName: string;
};

export class ApiPipelineCoordinator implements Disposable {
    private readonly pendingStore = new PendingRequestStore();
    private readonly invokeSender: InvokeSender;
    private readonly resultDispatcher: ApiResultDispatcher;
    private readonly remoteHookInvoker: RemoteHookInvoker;
    private readonly callReceiver: Disposable;
    private readonly responseReceiver: Disposable;
    private readonly afterChains = new Map<string, AfterChainEntry>();
    private switching = false;
    private disposed = false;

    constructor(
        private readonly runtime: KairoRuntime,
        private readonly snapshotResolver: CallSnapshotResolver,
        private readonly getWorld: () => KairoWorldState,
        private readonly getKairoKairoId: () => KairoId,
    ) {
        this.invokeSender = new InvokeSender(runtime);
        this.resultDispatcher = new ApiResultDispatcher(runtime);
        this.remoteHookInvoker = new RemoteHookInvoker(runtime);
        this.remoteHookInvoker.setup();

        this.callReceiver = runtime.receive((id, message) => {
            if (id !== ApiEventId.ApiCall) return;
            void this.handleApiCall(message);
        });

        this.responseReceiver = runtime.receive((id, message) => {
            if (id !== ApiEventId.ApiResponse) return;
            void this.handleApiHandlerResponse(message);
        });
    }

    enterSwitchingMode(): void {
        this.switching = true;
        const correlationIds = this.pendingStore.drainAll();
        for (const correlationId of correlationIds) {
            this.afterChains.delete(correlationId);
            this.resultDispatcher.sendSwitching(correlationId);
        }
    }

    exitSwitchingMode(): void {
        this.switching = false;
    }

    cancelPendingForAddon(targetKairoId: KairoId): void {
        const correlationIds = this.pendingStore.drainByTarget(targetKairoId);
        for (const correlationId of correlationIds) {
            this.afterChains.delete(correlationId);
            this.resultDispatcher.sendCanceled(correlationId, "ADDON_INACTIVE");
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.callReceiver.dispose();
        this.responseReceiver.dispose();
        this.remoteHookInvoker.dispose();
        this.afterChains.clear();
    }

    private async handleApiCall(rawMessage: string): Promise<void> {
        let call: ApiCall;
        try {
            const parsed = safeJsonParse(rawMessage, () => new Error("parse error"));
            if (!validateApiCall(parsed)) {
                return;
            }
            call = parsed as ApiCall;
        } catch {
            return;
        }

        if (this.switching) {
            if (call.type === "request") {
                this.resultDispatcher.sendSwitching(call.correlationId);
            }
            return;
        }

        const world = this.getWorld();
        const snapshot = this.snapshotResolver.resolve(
            call.targetAddonId,
            call.apiName,
            call.callerAddonId ?? "unknown",
            world,
        );

        if ("kind" in snapshot) {
            if (call.type === "request") {
                switch (snapshot.kind) {
                    case "ADDON_NOT_FOUND":
                        this.resultDispatcher.sendCanceled(call.correlationId, "ADDON_NOT_FOUND");
                        break;
                    case "ADDON_INACTIVE":
                        this.resultDispatcher.sendCanceled(call.correlationId, "ADDON_INACTIVE");
                        break;
                    case "ADDON_UNRESOLVED":
                        this.resultDispatcher.sendCanceled(call.correlationId, "ADDON_UNRESOLVED");
                        break;
                    case "API_NOT_FOUND":
                        this.resultDispatcher.sendError(call.correlationId, "API_NOT_FOUND");
                        break;
                }
            }
            return;
        }

        const timeoutTicks = call.timeout ?? DEFAULT_TIMEOUT_TICKS;

        if (call.type === "request") {
            const pending: PendingEntry = {
                correlationId: call.correlationId,
                callerKairoId: "unknown",
                targetKairoId: snapshot.targetKairoId,
                deadlineTick: this.runtime.currentTick() + timeoutTicks,
                committed: false,
            };
            this.pendingStore.create(pending);

            this.runtime.runTimeout(() => {
                const entry = this.pendingStore.get(call.correlationId);
                if (!entry || entry.committed) return;
                this.pendingStore.remove(call.correlationId);
                this.afterChains.delete(call.correlationId);
                this.resultDispatcher.sendError(call.correlationId, "TIMEOUT");
            }, timeoutTicks);
        }

        let args: unknown;
        try {
            args = JSON.parse(call.args);
        } catch {
            if (call.type === "request") {
                this.pendingStore.remove(call.correlationId);
                this.resultDispatcher.sendError(call.correlationId, "PROTOCOL_ERROR", "Failed to parse args");
            }
            return;
        }

        const rollback = new RollbackExecutor();
        const runner = new HookPhaseRunner(rollback, this.remoteHookInvoker);

        const beforeResult = await runner.runBefore(
            snapshot.hookChain.before,
            args,
            snapshot.callerAddonId,
            call.type,
            call.apiName,
        );

        if (beforeResult.kind === "failed") {
            if (call.type === "request") {
                this.pendingStore.remove(call.correlationId);
                const msg = beforeResult.error instanceof Error ? beforeResult.error.message : String(beforeResult.error);
                this.resultDispatcher.sendError(call.correlationId, "BEFORE_HOOK_EXECUTION", msg);
            } else {
            }
            return;
        }

        if (beforeResult.kind === "canceled") {
            if (call.type === "request") {
                this.pendingStore.remove(call.correlationId);
                this.resultDispatcher.sendCanceled(call.correlationId, "CANCELED_BY_HOOK");
            }
            return;
        }

        if (beforeResult.kind === "completed") {
            if (call.type === "request") {
                this.pendingStore.remove(call.correlationId);
                this.resultDispatcher.sendSuccess(call.correlationId, beforeResult.result);
            }
            return;
        }

        const invoke = {
            type: call.type,
            correlationId: call.correlationId,
            callerAddonId: snapshot.callerAddonId,
            apiName: call.apiName,
            args: JSON.stringify(beforeResult.modifiedArgs),
            timestamp: this.runtime.currentTick(),
        };
        this.invokeSender.send(snapshot.targetKairoId, invoke);

        if (call.type === "request") {
            this.afterChains.set(call.correlationId, {
                runner,
                afterChain: snapshot.hookChain.after,
                callerAddonId: snapshot.callerAddonId,
                apiName: call.apiName,
            });
        }
    }

    private async handleApiHandlerResponse(rawMessage: string): Promise<void> {
        let response: ApiHandlerResponse;
        try {
            const parsed = safeJsonParse(rawMessage, () => new Error("parse error"));
            if (!validateApiHandlerResponse(parsed)) {
                return;
            }
            response = parsed as ApiHandlerResponse;
        } catch {
            return;
        }

        const correlationId = response.correlationId;
        const pending = this.pendingStore.get(correlationId);
        if (!pending) return;

        this.pendingStore.markCommitted(correlationId);

        const afterState = this.afterChains.get(correlationId);
        this.afterChains.delete(correlationId);

        if (!response.success) {
            this.pendingStore.remove(correlationId);
            this.resultDispatcher.sendError(correlationId, "HANDLER_EXECUTION", response.error);
            return;
        }

        let result: unknown;
        try {
            result = response.result !== undefined ? JSON.parse(response.result) : undefined;
        } catch {
            this.pendingStore.remove(correlationId);
            this.resultDispatcher.sendError(correlationId, "PROTOCOL_ERROR", "Failed to parse handler result");
            return;
        }

        if (afterState) {
            const afterRollback = new RollbackExecutor();
            const afterRunner = new HookPhaseRunner(afterRollback, this.remoteHookInvoker);
            const afterResult = await afterRunner.runAfter(
                afterState.afterChain,
                result,
                afterState.callerAddonId,
                "request",
                this.getKairoKairoId(),
                afterState.apiName,
            );

            if (afterResult.kind === "failed") {
                this.pendingStore.remove(correlationId);
                const msg = afterResult.error instanceof Error ? afterResult.error.message : String(afterResult.error);
                this.resultDispatcher.sendError(correlationId, "AFTER_HOOK_EXECUTION", msg);
                return;
            }

            result = afterResult.result;
        }

        this.pendingStore.remove(correlationId);
        this.resultDispatcher.sendSuccess(correlationId, result);
    }
}

const validateApiCall = compile(ApiCallSchema);
const validateApiHandlerResponse = compile(ApiHandlerResponseSchema);
