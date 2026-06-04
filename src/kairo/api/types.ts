import type { AddonState } from "../activation/types/state";

export type KairoId = string;
export type AddonId = string;

export type BeforeHookFn = (ctx: {
    args: unknown;
    readonly callerAddonId: string;
    cancel(result?: unknown): never;
    setRollbackData(data: unknown): void;
}) => Promise<void>;

export type AfterHookFn = (ctx: {
    readonly args: unknown;
    result: unknown;
    readonly callerAddonId: string;
}) => Promise<void>;

export type RollbackFn = (ctx: {
    readonly rollbackData: unknown;
    readonly currentArgsSnapshot: unknown;
    readonly callerAddonId: string;
}) => Promise<unknown>;

export type ResolvedHook = {
    readonly addonId: AddonId;
    readonly providerKairoId: KairoId;
    readonly sequence: number;
    readonly declarationSequence: number;
    readonly phases: ReadonlyArray<"before" | "after">;
    readonly modes: ReadonlyArray<"send" | "request">;
    readonly hasRollback: boolean;
    readonly beforeFn?: BeforeHookFn;
    readonly afterFn?: AfterHookFn;
    readonly rollbackFn?: RollbackFn;
    readonly isKairoInternal: boolean;
};

export type ResolvedHookChain = {
    readonly before: ReadonlyArray<ResolvedHook>;
    readonly after: ReadonlyArray<ResolvedHook>;
};

export type ResolvedCallSnapshot = {
    readonly targetKairoId: KairoId;
    readonly callerAddonId: AddonId;
    readonly hookChain: ResolvedHookChain;
};

export type RoutingError =
    | { readonly kind: "ADDON_NOT_FOUND" }
    | { readonly kind: "ADDON_INACTIVE" }
    | { readonly kind: "ADDON_UNRESOLVED" }
    | { readonly kind: "API_NOT_FOUND" };

export type HookTableEntry = {
    readonly providerAddonId: AddonId;
    readonly providerKairoId: KairoId;
    readonly priority: number;
    readonly sequence: number;
    readonly declarationSequence: number;
    readonly phases: ReadonlyArray<"before" | "after">;
    readonly modes: ReadonlyArray<"send" | "request">;
    readonly hasRollback: boolean;
    readonly beforeFn?: BeforeHookFn;
    readonly afterFn?: AfterHookFn;
    readonly rollbackFn?: RollbackFn;
    readonly isKairoInternal: boolean;
};

export type RoutingTable = ReadonlyMap<AddonId, ReadonlyMap<string, KairoId>>;
export type HookTable = ReadonlyMap<string, ReadonlyArray<HookTableEntry>>;

export type HandlerResponsePayload = {
    readonly success: boolean;
    readonly result?: string;
    readonly error?: string;
};

export type PendingEntry = {
    readonly correlationId: string;
    readonly callerKairoId: KairoId;
    readonly targetKairoId: KairoId;
    readonly deadlineTick: number;
    committed: boolean;
};

export enum TrackingState {
    Active = "Active",
    TimedOut = "TimedOut",
}
