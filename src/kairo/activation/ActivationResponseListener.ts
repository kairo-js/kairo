import { BaseListener } from "../BaseListener";
import { ActivationEventId } from "./constants/ActivationEventId";

type Handler = (message: string) => void;
const ACTIVATION_EVENT_ID_SET = new Set<ActivationEventId>(Object.values(ActivationEventId));

export class ActivationResponseListener extends BaseListener<ActivationEventId> {
    constructor(private readonly handlers: Partial<Record<ActivationEventId, Handler>>) {
        super();
    }

    protected filter(id: string): id is ActivationEventId {
        return ACTIVATION_EVENT_ID_SET.has(id as ActivationEventId);
    }

    protected handle(id: ActivationEventId, message: string): void {
        this.handlers?.[id]?.(message);
    }
}
