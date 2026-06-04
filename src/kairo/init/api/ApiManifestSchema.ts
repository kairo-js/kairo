import { compile } from "@kairo-js/utils";
import { type Static, Type } from "@sinclair/typebox";

const CommandParamEntrySchema = Type.Object({
    name: Type.String(),
    type: Type.String(),
});

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
        commands: Type.Optional(
            Type.Array(
                Type.Object({
                    name: Type.String(),
                    mandatoryParameters: Type.Array(CommandParamEntrySchema),
                    optionalParameters: Type.Array(CommandParamEntrySchema),
                }),
            ),
        ),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export type ApiManifestMessage = Static<typeof ApiManifestMessageSchema>;
export type ApiManifest = Pick<ApiManifestMessage, "apis" | "hooks" | "eventSubscriptions" | "commands">;
export type ApiManifestHookEntry = ApiManifestMessage["hooks"][number];
export type CommandDeclarationEntry = NonNullable<ApiManifestMessage["commands"]>[number];

export const validateApiManifestMessage = compile(ApiManifestMessageSchema);
