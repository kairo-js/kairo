import { SCRIPT_EVENT_COMMAND_TYPES } from "../constants/scriptevent";
import {
    KairoUtils,
    type KairoCommand,
    type KairoResponse,
    type PlayerKairoDataDTO,
} from "../utils/KairoUtils";
import type { SystemManager } from "./SystemManager";

export class ScriptEventReceiver {
    private constructor(private readonly systemManager: SystemManager) {}
    public static create(systemManager: SystemManager): ScriptEventReceiver {
        return new ScriptEventReceiver(systemManager);
    }

    public async handleScriptEvent(command: KairoCommand): Promise<void | KairoResponse> {
        switch (command.commandType) {
            case SCRIPT_EVENT_COMMAND_TYPES.GET_PLAYER_KAIRO_DATA: {
                const playerId = command.data.playerId;
                const playerKairoData = await this.systemManager.getPlayerKairoData(playerId);

                const playerKairoDataDTO: PlayerKairoDataDTO = {
                    playerId,
                    joinOrder: playerKairoData.getJoinOrder(),
                    states: playerKairoData.getStates(),
                };

                return KairoUtils.buildKairoResponse({
                    playerKairoData: playerKairoDataDTO,
                });
            }

            case SCRIPT_EVENT_COMMAND_TYPES.GET_PLAYERS_KAIRO_DATA: {
                const playersKairoData = await this.systemManager.getPlayersKairoData();

                const playersKairoDataDTO: PlayerKairoDataDTO[] = Array.from(
                    playersKairoData.entries(),
                ).map(([playerId, kairoData]) => ({
                    playerId,
                    joinOrder: kairoData.getJoinOrder(),
                    states: kairoData.getStates(),
                }));

                return KairoUtils.buildKairoResponse({
                    playersKairoData: playersKairoDataDTO,
                });
            }

            default:
                return;
        }
    }
}
