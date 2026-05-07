import type { SystemManager } from "../SystemManager";
import { BaseEventManager } from "./BaseEventManager";
import { PlayerSpawnHandler } from "./PlayerSpawn";

export class SystemEventManager extends BaseEventManager {
    private readonly playerSpawn: PlayerSpawnHandler;
    private constructor(private readonly systemManager: SystemManager) {
        super();
        this.playerSpawn = PlayerSpawnHandler.create(this);
    }

    public static create(systemManager: SystemManager): SystemEventManager {
        return new SystemEventManager(systemManager);
    }

    public override subscribeAll(): void {
        this.playerSpawn.subscribe();
    }

    public override unsubscribeAll(): void {
        this.playerSpawn.unsubscribe();
    }

    public getSystemManager(): SystemManager {
        return this.systemManager;
    }
}
