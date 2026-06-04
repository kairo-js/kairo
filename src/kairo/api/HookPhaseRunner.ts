import { RollbackExecutor } from "./RollbackExecutor";
import type { RemoteHookInvoker } from "./RemoteHookInvoker";
import type { ResolvedHook } from "./types";

type CancelSignal = {
    result: unknown;
    hasResult: boolean;
};

type BeforeRunResult =
    | { kind: "invoke"; modifiedArgs: unknown }
    | { kind: "completed"; result: unknown }
    | { kind: "canceled" }
    | { kind: "failed"; error: unknown };

type AfterRunResult =
    | { kind: "completed"; result: unknown }
    | { kind: "failed"; error: unknown };

export class HookPhaseRunner {
    constructor(
        private readonly rollback: RollbackExecutor,
        private readonly remoteInvoker?: RemoteHookInvoker,
    ) {}

    async runBefore(
        hooks: ReadonlyArray<ResolvedHook>,
        initialArgs: unknown,
        callerAddonId: string,
        callType: "send" | "request",
        apiName: string,
    ): Promise<BeforeRunResult> {
        let args = initialArgs;

        for (const hook of hooks) {
            if (!hook.modes.includes(callType)) continue;

            if (hook.beforeFn) {
                // Local execution
                const rollbackDataStore = { data: undefined as unknown };
                const cancelState = { signal: null as CancelSignal | null };

                const ctx = {
                    get args() { return args; },
                    set args(v: unknown) { args = v; },
                    callerAddonId,
                    cancel(result?: unknown): never {
                        if (!cancelState.signal) {
                            cancelState.signal = { result, hasResult: result !== undefined };
                        }
                        return undefined as never;
                    },
                    setRollbackData(data: unknown): void {
                        rollbackDataStore.data = data;
                    },
                };

                try {
                    await hook.beforeFn(ctx);
                } catch (e) {
                    await this.rollback.execute(args, callerAddonId);
                    this.rollback.clear();
                    return { kind: "failed", error: e };
                }

                const signal = cancelState.signal;
                if (signal) {
                    if (signal.hasResult) return { kind: "completed", result: signal.result };
                    return { kind: "canceled" };
                }

                if (hook.rollbackFn) {
                    this.rollback.push(hook.rollbackFn, rollbackDataStore.data);
                }

            } else if (hook.phases.includes("before") && !hook.isKairoInternal && this.remoteInvoker) {
                // Remote execution
                const result = await this.remoteInvoker.invokeBefore(hook, args, callerAddonId, callType, apiName);

                if (result.outcome === "failed") {
                    await this.rollback.execute(args, callerAddonId);
                    this.rollback.clear();
                    return { kind: "failed", error: new Error(result.error ?? "Remote before hook failed") };
                }
                if (result.outcome === "cancel") return { kind: "canceled" };
                if (result.outcome === "cancel_with_result") return { kind: "completed", result: result.cancelResult };

                // continue
                args = result.modifiedArgs;
                if (hook.hasRollback) {
                    const capturedHook = hook;
                    const capturedCallerAddonId = callerAddonId;
                    const capturedCallType = callType;
                    const capturedApiName = apiName;
                    const capturedRollbackData = result.hasRollbackData ? result.rollbackData : undefined;
                    this.rollback.push(
                        async (ctx) => this.remoteInvoker!.invokeRollback(
                            capturedHook,
                            ctx.currentArgsSnapshot,
                            ctx.rollbackData,
                            capturedCallerAddonId,
                            capturedCallType,
                            capturedApiName,
                        ),
                        capturedRollbackData,
                    );
                }
            }
        }

        this.rollback.clear();
        return { kind: "invoke", modifiedArgs: args };
    }

    async runAfter(
        hooks: ReadonlyArray<ResolvedHook>,
        initialResult: unknown,
        callerAddonId: string,
        callType: "send" | "request",
        kairoKairoId: string,
        apiName: string,
    ): Promise<AfterRunResult> {
        let result = initialResult;

        for (const hook of hooks) {
            if (!hook.modes.includes(callType)) continue;

            if (hook.afterFn) {
                // Local execution
                const resultHolder = { value: result };
                const ctx = {
                    get args(): unknown { return undefined; },
                    get result(): unknown { return resultHolder.value; },
                    set result(v: unknown) { resultHolder.value = v; },
                    callerAddonId,
                };

                try {
                    await hook.afterFn(ctx);
                } catch (e) {
                    if (hook.isKairoInternal) continue;
                    return { kind: "failed", error: e };
                }

                result = resultHolder.value;

            } else if (hook.phases.includes("after") && !hook.isKairoInternal && this.remoteInvoker) {
                // Remote execution
                const remoteResult = await this.remoteInvoker.invokeAfter(hook, result, callerAddonId, callType, apiName);

                if (remoteResult.outcome === "failed") {
                    return { kind: "failed", error: new Error(remoteResult.error ?? "Remote after hook failed") };
                }
                result = remoteResult.modifiedResult;
            }
        }

        return { kind: "completed", result };
    }
}
