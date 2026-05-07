import { world, type PlayerSpawnAfterEvent } from "@minecraft/server";
import { BaseEventHandler } from "./BaseEventHandler";
import type { SystemEventManager } from "./SystemEventManager";

export class PlayerSpawnHandler extends BaseEventHandler<undefined, PlayerSpawnAfterEvent> {
    private constructor(private readonly systemEventManager: SystemEventManager) {
        super(systemEventManager);
    }
    public static create(systemEventManager: SystemEventManager): PlayerSpawnHandler {
        return new PlayerSpawnHandler(systemEventManager);
    }

    protected afterEvent = world.afterEvents.playerSpawn;

    protected handleAfter(ev: PlayerSpawnAfterEvent): void {
        const { initialSpawn, player } = ev;

        if (initialSpawn) {
            this.systemEventManager.getSystemManager().addOrRestorePlayerKairoData(player);
        }
    }
}
