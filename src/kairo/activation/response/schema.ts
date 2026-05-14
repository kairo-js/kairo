import { type Static, Type } from "@sinclair/typebox";

export const ActivationResponseSchema = Type.Object(
    {
        timestamp: Type.Integer({ minimum: 0 }),
        kairoId: Type.String(),
        status: Type.Union([Type.Literal("success"), Type.Literal("failure")]),
        action: Type.Union([Type.Literal("activate"), Type.Literal("deactivate")]),
        reason: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);

export type ActivationResponse = Static<typeof ActivationResponseSchema>;
