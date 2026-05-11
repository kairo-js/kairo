import fastJson from "fast-json-stringify";
import { type DiscoveryQuery, DiscoveryQuerySchema } from "./schema";

export const stringifyDiscoveryQuery: (query: DiscoveryQuery) => string =
    fastJson(DiscoveryQuerySchema);
