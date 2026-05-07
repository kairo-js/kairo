import { Player, world } from "@minecraft/server";
import type { SystemManager } from "./SystemManager";
import { KairoUtils, type PlayerKairoState } from "../utils/KairoUtils";
import { KAIRO_DATAVAULT_KEYS } from "../constants/system";
import { PlayerKairoData } from "./PlayerKairoData";

export interface PlayerKairoDataSerialized {
    playerId: string;
    states: PlayerKairoState[];
}

export class PlayerKairoDataManager {
    private playersKairoData = new Map<string, PlayerKairoData>();
    private lastSavedPlayersKairoData = new Map<string, PlayerKairoDataSerialized>();
    private validStates = new Set<string>();
    private joinOrder = 0;

    private initPromise: Promise<void> | null = null;
    private initialized = false;

    private constructor(
        private readonly systemManager: SystemManager,
        initialStates: string[] = [],
    ) {
        for (const s of initialStates) {
            this.registerState(s);
        }
    }

    public static create(
        systemManager: SystemManager,
        initialStates: string[],
    ): PlayerKairoDataManager {
        return new PlayerKairoDataManager(systemManager, initialStates);
    }

    public async init(): Promise<void> {
        if (this.initialized) return;

        if (!this.initPromise) {
            this.initPromise = (async () => {
                KairoUtils.loadFromDataVault(KAIRO_DATAVAULT_KEYS.KAIRO_PLAYERS_DATA);

                const dataLoaded = await KairoUtils.loadFromDataVault(
                    KAIRO_DATAVAULT_KEYS.KAIRO_PLAYERS_DATA,
                );

                let playersDataSerializedMap = new Map<string, PlayerKairoDataSerialized>();

                if (typeof dataLoaded === "string" && dataLoaded.length > 0) {
                    try {
                        const playersDataSerialized = JSON.parse(
                            dataLoaded,
                        ) as PlayerKairoDataSerialized[];
                        playersDataSerializedMap = new Map(
                            playersDataSerialized.map((item) => [item.playerId, item]),
                        );
                    } catch {
                        playersDataSerializedMap = new Map();
                    }
                }

                const players = world.getPlayers();
                for (const player of players) {
                    const playerDataSerialized = playersDataSerializedMap.get(player.id);
                    const initialStates =
                        playerDataSerialized !== undefined ? playerDataSerialized.states : [];

                    const playerKairoData = new PlayerKairoData(
                        this,
                        this.joinOrder++,
                        initialStates,
                    );
                    this.playersKairoData.set(player.id, playerKairoData);
                }

                this.savePlayersKairoDataToDataVault();
                this.initialized = true;
            })();
        }

        await this.initPromise;
    }

    public addOrRestorePlayerKairoData(player: Player): void {
        const existing = this.playersKairoData.get(player.id);

        if (existing) {
            existing.setJoinOrder(this.joinOrder++);
            this.savePlayersKairoDataToDataVault();
            return;
        }

        const past = this.lastSavedPlayersKairoData.get(player.id);

        let initialStates: PlayerKairoState[] = [];
        if (past) {
            initialStates = past.states ?? [];
        }

        const playerData = new PlayerKairoData(this, this.joinOrder++, initialStates);
        this.playersKairoData.set(player.id, playerData);
        this.savePlayersKairoDataToDataVault();
    }

    public savePlayersKairoDataToDataVault(): void {
        const serialized: PlayerKairoDataSerialized[] = Array.from(
            this.playersKairoData,
            ([playerId, kairoData]) => ({
                playerId,
                states: [...kairoData.getStates()],
            }),
        );

        this.lastSavedPlayersKairoData = new Map(serialized.map((item) => [item.playerId, item]));
        const json = JSON.stringify(serialized);
        KairoUtils.saveToDataVault(KAIRO_DATAVAULT_KEYS.KAIRO_PLAYERS_DATA, json);
    }

    public registerState(state: string): PlayerKairoState {
        this.validStates.add(state);
        return state as PlayerKairoState;
    }

    public validateOrThrow(state: string): PlayerKairoState {
        if (!this.validStates.has(state)) {
            throw new Error(`State "${state}" is not registered in PlayerKairoDataManager.`);
        }
        return state as PlayerKairoState;
    }

    public hasState(state: string): state is PlayerKairoState {
        return this.validStates.has(state);
    }

    public getAllStates(): PlayerKairoState[] {
        return [...this.validStates] as PlayerKairoState[];
    }

    public async getPlayerKairoData(playerId: string): Promise<PlayerKairoData> {
        await this.init();
        return this.playersKairoData.get(playerId) as PlayerKairoData;
    }

    public async getPlayersKairoData(): Promise<Map<string, PlayerKairoData>> {
        await this.init();
        return this.playersKairoData;
    }
}
