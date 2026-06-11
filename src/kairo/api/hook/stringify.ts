import type { HookInvokeMessage } from "./schema";

export const stringifyHookInvokeMessage = (msg: HookInvokeMessage): string =>
    JSON.stringify(msg);
