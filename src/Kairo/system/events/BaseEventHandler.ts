import type { BaseEventManager } from "./BaseEventManager";

export abstract class BaseEventHandler<
    TBefore = undefined,
    TAfter = undefined,
    TManager extends BaseEventManager = BaseEventManager,
> {
    protected isSubscribed = false;

    private boundBefore?: (ev: TBefore) => void;
    private boundAfter?: (ev: TAfter) => void;

    protected constructor(protected readonly eventManager: TManager) {}

    protected beforeEvent?: {
        subscribe(cb: (ev: TBefore) => void): void;
        unsubscribe(cb: (ev: TBefore) => void): void;
    };

    protected afterEvent?: {
        subscribe(cb: (ev: TAfter) => void): void;
        unsubscribe(cb: (ev: TAfter) => void): void;
    };

    protected handleBefore?(ev: TBefore): void | Promise<void>;
    protected handleAfter?(ev: TAfter): void | Promise<void>;

    protected async _handleBefore(ev: TBefore): Promise<void> {
        await this.handleBefore?.(ev);
    }

    protected async _handleAfter(ev: TAfter): Promise<void> {
        await this.handleAfter?.(ev);
    }

    public subscribe(): void {
        if (this.isSubscribed) return;

        if (this.beforeEvent) {
            this.boundBefore = (ev) => void this._handleBefore(ev);
            this.beforeEvent.subscribe(this.boundBefore);
        }

        if (this.afterEvent) {
            this.boundAfter = (ev) => void this._handleAfter(ev);
            this.afterEvent.subscribe(this.boundAfter);
        }

        this.isSubscribed = true;
    }

    public unsubscribe(): void {
        if (!this.isSubscribed) return;

        if (this.beforeEvent && this.boundBefore) {
            this.beforeEvent.unsubscribe(this.boundBefore);
        }

        if (this.afterEvent && this.boundAfter) {
            this.afterEvent.unsubscribe(this.boundAfter);
        }

        this.isSubscribed = false;
    }
}
