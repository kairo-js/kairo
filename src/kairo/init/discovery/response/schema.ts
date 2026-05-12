import { type Static, Type } from "@sinclair/typebox";

export const DiscoveryResponseSchema = Type.Object(
    {
        kairoId: Type.String(),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

export type DiscoveryResponse = Static<typeof DiscoveryResponseSchema>;
