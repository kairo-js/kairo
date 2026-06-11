import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { ApiEventId } from "./ApiEventId";
import type { ApiInvoke } from "./protocol/schema";
import { stringifyApiInvoke } from "./protocol/stringify";
import type { KairoId } from "./types";

export class InvokeSender {
    constructor(private readonly runtime: KairoRuntime) {}

    send(targetKairoId: KairoId, invoke: ApiInvoke): void {
        try {
            this.runtime.send(ApiEventId.apiInvoke(targetKairoId), stringifyApiInvoke(invoke));
        } catch {
            // send failure is silently ignored
        }
    }
}
