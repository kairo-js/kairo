import type { RegistrationResult } from "./schema";

export const stringifyRegistrationResult = (result: RegistrationResult): string =>
    JSON.stringify(result);
