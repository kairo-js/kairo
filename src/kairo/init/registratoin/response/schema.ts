import { type Static, Type } from "@sinclair/typebox";

export const RegistrationResponseSchema = Type.Object(
    {
        kairoRegistry: Type.Object({
            kairoId: Type.String(),
            addonId: Type.String(),
            name: Type.String(),
            description: Type.String(),
            version: Type.Object({
                major: Type.Number(),
                minor: Type.Number(),
                patch: Type.Number(),
                prerelease: Type.Optional(Type.String()),
                build: Type.Optional(Type.String()),
            }),
            metadata: Type.Object({
                authors: Type.Array(Type.String()),
                url: Type.Optional(Type.String()),
                license: Type.Optional(Type.String()),
            }),
            requiredAddons: Type.Record(Type.String(), Type.String()),
            tags: Type.Array(Type.String()),
        }),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    {
        additionalProperties: false,
    },
);

export type RegistrationResponse = Static<typeof RegistrationResponseSchema>;
