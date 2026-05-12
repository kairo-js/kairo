import { BaseListener } from "../BaseListener";
import { KairoInitEventId } from "./constants/KairoInitEventId";

type Handler = (message: string) => void;
const KAIRO_INIT_EVENT_ID_SET = new Set<KairoInitEventId>(Object.values(KairoInitEventId));

export class KairoInitListener extends BaseListener<KairoInitEventId> {
    constructor(private readonly handlers: Partial<Record<KairoInitEventId, Handler>>) {
        super();
    }

    protected filter(id: string): id is KairoInitEventId {
        return KAIRO_INIT_EVENT_ID_SET.has(id as KairoInitEventId);
    }

    protected handle(id: KairoInitEventId, message: string): void {
        this.handlers?.[id]?.(message);
    }
}
