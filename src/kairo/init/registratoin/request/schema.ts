import { type Static, Type } from "@sinclair/typebox";

export const RegistrationRequestSchema = Type.Object(
    {
        approvals: Type.Array(Type.String()),
        rejects: Type.Array(Type.String()),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    {
        additionalProperties: false,
    },
);

export type RegistrationRequest = Static<typeof RegistrationRequestSchema>;
