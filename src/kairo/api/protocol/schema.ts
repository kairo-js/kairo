import { type Static, Type } from "@sinclair/typebox";

export const ApiCallSchema = Type.Object(
    {
        type: Type.Union([Type.Literal("send"), Type.Literal("request")]),
        correlationId: Type.String(),
        targetAddonId: Type.String(),
        callerAddonId: Type.Optional(Type.String()),
        apiName: Type.String(),
        args: Type.String(),
        timeout: Type.Optional(Type.Integer({ minimum: 1 })),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export const ApiInvokeSchema = Type.Object(
    {
        type: Type.Union([Type.Literal("send"), Type.Literal("request")]),
        correlationId: Type.String(),
        callerAddonId: Type.String(),
        apiName: Type.String(),
        args: Type.String(),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export const ApiHandlerResponseSchema = Type.Object(
    {
        correlationId: Type.String(),
        success: Type.Boolean(),
        result: Type.Optional(Type.String()),
        error: Type.Optional(Type.String()),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export const ApiResultSchema = Type.Object(
    {
        correlationId: Type.String(),
        success: Type.Boolean(),
        result: Type.Optional(Type.String()),
        canceled: Type.Optional(Type.Literal(true)),
        reason: Type.Optional(Type.String()),
        errorType: Type.Optional(
            Type.Union([
                Type.Literal("API_NOT_FOUND"),
                Type.Literal("BEFORE_HOOK_EXECUTION"),
                Type.Literal("AFTER_HOOK_EXECUTION"),
                Type.Literal("HANDLER_EXECUTION"),
                Type.Literal("TIMEOUT"),
                Type.Literal("PROTOCOL_ERROR"),
                Type.Literal("HOST_SWITCHING"),
            ]),
        ),
        error: Type.Optional(Type.String()),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export type ApiCall = Static<typeof ApiCallSchema>;
export type ApiInvoke = Static<typeof ApiInvokeSchema>;
export type ApiHandlerResponse = Static<typeof ApiHandlerResponseSchema>;
export type ApiResult = Static<typeof ApiResultSchema>;

export type ApiResultErrorType = NonNullable<ApiResult["errorType"]>;
