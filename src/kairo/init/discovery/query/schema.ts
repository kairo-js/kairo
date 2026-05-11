import { type Static, Type } from "@sinclair/typebox";

export const DiscoveryQuerySchema = Type.Object(
    {
        timestamp: Type.Integer({ minimum: 0 }),
        idNamespace: Type.String(),
    },
    {
        additionalProperties: false,
    },
);

export type DiscoveryQuery = Static<typeof DiscoveryQuerySchema>;
