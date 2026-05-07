export abstract class BaseEventManager {
    protected constructor() {}

    public abstract subscribeAll(): void;
    public abstract unsubscribeAll(): void;
}
