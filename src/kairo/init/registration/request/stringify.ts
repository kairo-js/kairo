import type { RegistrationRequest } from "./schema";

export const stringifyRegistrationRequest = (request: RegistrationRequest): string =>
    JSON.stringify(request);
