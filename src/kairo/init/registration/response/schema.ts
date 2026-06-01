import { type Static, Type } from "@sinclair/typebox";

export const RegistrationResponseSchema = Type.Object(
    {
        kairoRegistry: Type.Object({
            kairoId: Type.Readonly(Type.String()),
            addonId: Type.Readonly(Type.String()),
            name: Type.Readonly(Type.String()),
            description: Type.Readonly(Type.String()),
            version: Type.Readonly(
                Type.Object({
                    major: Type.Number(),
                    minor: Type.Number(),
                    patch: Type.Number(),
                    prerelease: Type.Optional(Type.String()),
                    build: Type.Optional(Type.String()),
                }),
            ),
            metadata: Type.Readonly(
                Type.Object({
                    authors: Type.Readonly(Type.Array(Type.String())),
                    url: Type.Optional(Type.String()),
                    license: Type.Optional(Type.String()),
                }),
            ),
            dependencies: Type.Readonly(Type.Record(Type.String(), Type.String())),
            optionalDependencies: Type.Readonly(Type.Record(Type.String(), Type.String())),
            tags: Type.Readonly(Type.Array(Type.String())),
        }),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    {
        additionalProperties: false,
    },
);

export type RegistrationResponse = Static<typeof RegistrationResponseSchema>;
