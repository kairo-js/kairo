import { type Static, Type } from "@sinclair/typebox";

export const ActivationResultSchema = Type.Object({
    kairoId: Type.String(),
    status: Type.Union([Type.Literal("success"), Type.Literal("failure"), Type.Literal("timeout")]),
    action: Type.Union([Type.Literal("activate"), Type.Literal("deactivate")]),
    reason: Type.Optional(Type.String()),
});

export type ActivationResult = Static<typeof ActivationResultSchema>;
