import type { ApiInvoke, ApiResult } from "./schema";

export const stringifyApiInvoke = (invoke: ApiInvoke): string =>
    JSON.stringify(invoke);

export const stringifyApiResult = (result: ApiResult): string =>
    JSON.stringify(result);
