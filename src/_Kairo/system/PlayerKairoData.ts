import type { PlayerKairoState } from "../utils/KairoUtils";
import type { PlayerKairoDataManager } from "./PlayerKairoDataManager";

export class PlayerKairoData {
    private JoinOrder: number = 0;
    private kairoState: Set<PlayerKairoState>;

    public constructor(
        private readonly manager: PlayerKairoDataManager,
        JoinOrder: number,
        initialStates: PlayerKairoState[],
    ) {
        this.JoinOrder = JoinOrder;
        this.kairoState = new Set(initialStates);
    }

    public getJoinOrder(): number {
        return this.JoinOrder;
    }

    public setJoinOrder(order: number): void {
        this.JoinOrder = order;
    }

    public addState(newState: string): void {
        const validated = this.manager.validateOrThrow(newState);
        this.kairoState.add(validated);
    }

    public removeState(state: PlayerKairoState): void {
        this.kairoState.delete(state);
    }

    public hasState(state: PlayerKairoState): boolean {
        return this.kairoState.has(state);
    }

    public getStates(): PlayerKairoState[] {
        return [...this.kairoState];
    }

    public clearStates(): void {
        this.kairoState.clear();
    }
}
