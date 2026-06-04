import { type Static, Type } from "@sinclair/typebox";

export const HookInvokeMessageSchema = Type.Object(
    {
        hookCorrelationId: Type.String(),
        phase: Type.Union([Type.Literal("before"), Type.Literal("after"), Type.Literal("rollback")]),
        targetAddonId: Type.String(),
        apiName: Type.String(),
        declarationSequence: Type.Integer({ minimum: 0 }),
        args: Type.String(),
        result: Type.Optional(Type.String()),
        rollbackData: Type.Optional(Type.String()),
        callerAddonId: Type.String(),
        callType: Type.Union([Type.Literal("send"), Type.Literal("request")]),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export const HookResponseMessageSchema = Type.Object(
    {
        hookCorrelationId: Type.String(),
        outcome: Type.Union([
            Type.Literal("continue"),
            Type.Literal("cancel"),
            Type.Literal("cancel_with_result"),
            Type.Literal("failed"),
        ]),
        modifiedArgs: Type.Optional(Type.String()),
        cancelResult: Type.Optional(Type.String()),
        rollbackData: Type.Optional(Type.String()),
        modifiedResult: Type.Optional(Type.String()),
        returnedArgs: Type.Optional(Type.String()),
        error: Type.Optional(Type.String()),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export type HookInvokeMessage = Static<typeof HookInvokeMessageSchema>;
export type HookResponseMessage = Static<typeof HookResponseMessageSchema>;
