import type { DiscoveryQuery } from "./schema";

export const stringifyDiscoveryQuery = (query: DiscoveryQuery): string =>
    JSON.stringify(query);
