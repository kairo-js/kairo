import { compile } from "@kairo-js/utils";
import { type Static, Type } from "@sinclair/typebox";

export const ApiManifestMessageSchema = Type.Object(
    {
        kairoId: Type.String(),
        apis: Type.Array(Type.Object({ name: Type.String() })),
        hooks: Type.Array(
            Type.Object({
                targetAddonId: Type.String(),
                apiName: Type.String(),
                priority: Type.Integer({ minimum: -2147483648, maximum: 2147483647 }),
                phases: Type.Array(Type.String()),
                declarationSequence: Type.Integer({ minimum: 0 }),
                hasRollback: Type.Boolean(),
            }),
        ),
        eventSubscriptions: Type.Optional(
            Type.Array(
                Type.Object({
                    emitterAddonId: Type.String(),
                    eventName: Type.String(),
                }),
            ),
        ),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export type ApiManifestMessage = Static<typeof ApiManifestMessageSchema>;
export type ApiManifest = Pick<ApiManifestMessage, "apis" | "hooks" | "eventSubscriptions">;
export type ApiManifestHookEntry = ApiManifestMessage["hooks"][number];

export const validateApiManifestMessage = compile(ApiManifestMessageSchema);
