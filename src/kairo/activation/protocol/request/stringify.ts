import type { ActivationRequest } from "./schema";

export const stringifyActivationRequest = (query: ActivationRequest): string =>
    JSON.stringify(query);
