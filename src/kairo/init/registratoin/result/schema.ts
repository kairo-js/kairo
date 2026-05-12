import { type Static, Type } from "@sinclair/typebox";

export const RegistrationResultSchema = Type.Object(
    {
        kairoId: Type.String(),
        success: Type.Boolean(),
        reason: Type.Optional(Type.String()),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    {
        additionalProperties: false,
    },
);

export type RegistrationResult = Static<typeof RegistrationResultSchema>;
