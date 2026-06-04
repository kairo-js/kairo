import { compile, safeJsonParse } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import type { Disposable } from "@kairo-js/router";
import { HookResponseMessageSchema, type HookInvokeMessage, type HookResponseMessage } from "./hook/schema";
import type { ResolvedHook } from "./types";

const HOOK_TIMEOUT_TICKS = 20;

export type RemoteBeforeResult =
    | { outcome: "continue"; modifiedArgs: unknown; rollbackData: unknown; hasRollbackData: boolean }
    | { outcome: "cancel" }
    | { outcome: "cancel_with_result"; cancelResult: unknown }
    | { outcome: "failed"; error?: string };

export type RemoteAfterResult =
    | { outcome: "continue"; modifiedResult: unknown }
    | { outcome: "failed"; error?: string };

export class RemoteHookInvoker implements Disposable {
    private readonly pending = new Map<string, (response: HookResponseMessage) => void>();
    private counter = 0;
    private sessionId: string;
    private responseListener?: Disposable;
    private disposed = false;

    constructor(private readonly runtime: KairoRuntime) {
        this.sessionId = Math.random().toString(36).slice(2, 8);
    }

    setup(): void {
        this.responseListener = this.runtime.receive((id, message) => {
            if (id !== "kairo:hook-response") return;
            this.handleResponse(message);
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.pending.clear();
        this.responseListener?.dispose();
        this.responseListener = undefined;
    }

    async invokeBefore(
        hook: ResolvedHook,
        args: unknown,
        callerAddonId: string,
        callType: "send" | "request",
        apiName: string,
    ): Promise<RemoteBeforeResult> {
        const msg: HookInvokeMessage = {
            hookCorrelationId: this.nextId(),
            phase: "before",
            targetAddonId: hook.addonId,
            apiName,
            declarationSequence: hook.declarationSequence,
            args: JSON.stringify(args),
            callerAddonId,
            callType,
            timestamp: this.runtime.currentTick(),
        };

        const response = await this.send(hook.providerKairoId, msg);
        if (!response) return { outcome: "failed", error: "Hook invocation timed out" };

        if (response.outcome === "failed") return { outcome: "failed", error: response.error };
        if (response.outcome === "cancel") return { outcome: "cancel" };
        if (response.outcome === "cancel_with_result") {
            const cancelResult = response.cancelResult !== undefined ? JSON.parse(response.cancelResult) : undefined;
            return { outcome: "cancel_with_result", cancelResult };
        }

        const modifiedArgs = response.modifiedArgs !== undefined ? JSON.parse(response.modifiedArgs) : args;
        const hasRollbackData = response.rollbackData !== undefined;
        const rollbackData = hasRollbackData ? JSON.parse(response.rollbackData!) : undefined;
        return { outcome: "continue", modifiedArgs, rollbackData, hasRollbackData };
    }

    async invokeAfter(
        hook: ResolvedHook,
        result: unknown,
        callerAddonId: string,
        callType: "send" | "request",
        apiName: string,
    ): Promise<RemoteAfterResult> {
        const msg: HookInvokeMessage = {
            hookCorrelationId: this.nextId(),
            phase: "after",
            targetAddonId: hook.addonId,
            apiName,
            declarationSequence: hook.declarationSequence,
            args: "null",
            result: JSON.stringify(result),
            callerAddonId,
            callType,
            timestamp: this.runtime.currentTick(),
        };

        const response = await this.send(hook.providerKairoId, msg);
        if (!response) return { outcome: "failed", error: "Hook invocation timed out" };
        if (response.outcome === "failed") return { outcome: "failed", error: response.error };

        const modifiedResult = response.modifiedResult !== undefined ? JSON.parse(response.modifiedResult) : result;
        return { outcome: "continue", modifiedResult };
    }

    async invokeRollback(
        hook: ResolvedHook,
        currentArgsSnapshot: unknown,
        rollbackData: unknown,
        callerAddonId: string,
        callType: "send" | "request",
        apiName: string,
    ): Promise<unknown> {
        const msg: HookInvokeMessage = {
            hookCorrelationId: this.nextId(),
            phase: "rollback",
            targetAddonId: hook.addonId,
            apiName,
            declarationSequence: hook.declarationSequence,
            args: JSON.stringify(currentArgsSnapshot),
            rollbackData: JSON.stringify(rollbackData),
            callerAddonId,
            callType,
            timestamp: this.runtime.currentTick(),
        };

        const response = await this.send(hook.providerKairoId, msg);
        if (!response) return undefined;
        if (response.outcome !== "continue") return undefined;
        if (response.returnedArgs !== undefined) return JSON.parse(response.returnedArgs);
        return undefined;
    }

    private send(targetKairoId: string, msg: HookInvokeMessage): Promise<HookResponseMessage | null> {
        return new Promise<HookResponseMessage | null>((resolve) => {
            const timeoutDisposable = this.runtime.runTimeout(() => {
                this.pending.delete(msg.hookCorrelationId);
                resolve(null);
            }, HOOK_TIMEOUT_TICKS);

            this.pending.set(msg.hookCorrelationId, (response) => {
                timeoutDisposable.dispose();
                this.pending.delete(msg.hookCorrelationId);
                resolve(response);
            });

            try {
                this.runtime.send(`${targetKairoId}:hook-invoke`, JSON.stringify(msg));
            } catch {
                timeoutDisposable.dispose();
                this.pending.delete(msg.hookCorrelationId);
                resolve(null);
            }
        });
    }

    private handleResponse(rawMessage: string): void {
        let response: HookResponseMessage;
        try {
            const parsed = safeJsonParse(rawMessage, () => new Error("parse failed"));
            if (!validateHookResponse(parsed)) return;
            response = parsed as HookResponseMessage;
        } catch {
            return;
        }

        const resolver = this.pending.get(response.hookCorrelationId);
        if (resolver) resolver(response);
    }

    private nextId(): string {
        return `khk-${this.sessionId}-${this.counter++}`;
    }
}

const validateHookResponse = compile(HookResponseMessageSchema);
