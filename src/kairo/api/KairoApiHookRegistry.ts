import type { AfterHookFn, BeforeHookFn, HookTableEntry, KairoId, RollbackFn } from "./types";

export type KairoHookOptions = {
    priority?: number;
    before?: BeforeHookFn;
    after?: AfterHookFn;
    rollback?: RollbackFn;
};

// Stores hooks registered via kairo.api.hook(). These are kairo-internal hooks
// with non-fatal after throw semantics, executed directly in kairo's pipeline.
export class KairoApiHookRegistry {
    private readonly declarations: {
        targetAddonId: string;
        apiName: string;
        priority: number;
        sequence: number;
        beforeFn?: BeforeHookFn;
        afterFn?: AfterHookFn;
        rollbackFn?: RollbackFn;
    }[] = [];
    private sequenceCounter = 0;
    private kairoKairoId?: KairoId;

    setKairoKairoId(kairoId: KairoId): void {
        this.kairoKairoId = kairoId;
    }

    hook(targetAddonId: string, apiName: string, options: KairoHookOptions): void {
        if (!options.before && !options.after) {
            throw new Error("[kairo] kairo.api.hook() must have at least one of before or after");
        }
        this.declarations.push({
            targetAddonId,
            apiName,
            priority: options.priority ?? 0,
            sequence: this.sequenceCounter++,
            beforeFn: options.before,
            afterFn: options.after,
            rollbackFn: options.rollback,
        });
    }

    // Build HookTableEntry list for a given (targetAddonId, apiName)
    getEntriesFor(targetAddonId: string, apiName: string): HookTableEntry[] {
        return this.declarations
            .filter((d) => d.targetAddonId === targetAddonId && d.apiName === apiName)
            .map((d) => ({
                providerAddonId: "kairo",
                providerKairoId: this.kairoKairoId ?? "kairo",
                priority: d.priority,
                sequence: d.sequence,
                declarationSequence: d.sequence,
                phases: [
                    ...(d.beforeFn ? ["before" as const] : []),
                    ...(d.afterFn ? ["after" as const] : []),
                ] as ReadonlyArray<"before" | "after">,
                modes: ["send", "request"] as ReadonlyArray<"send" | "request">,
                hasRollback: !!d.rollbackFn,
                beforeFn: d.beforeFn,
                afterFn: d.afterFn,
                rollbackFn: d.rollbackFn,
                isKairoInternal: true,
            }));
    }
}
