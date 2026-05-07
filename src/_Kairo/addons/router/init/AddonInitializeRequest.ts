import { system, WorldLoadAfterEvent } from "@minecraft/server";
import { ConsoleManager } from "../../../utils/ConsoleManager";
import type { AddonInitializer } from "./AddonInitializer";
import { ScoreboardManager } from "../../../utils/ScoreboardManager";
import { SCOREBOARD_NAMES } from "../../../constants/scoreboard";
import { SCRIPT_EVENT_IDS, SCRIPT_EVENT_MESSAGES } from "../../../constants/scriptevent";

/**
 * ルーターが各アドオンに登録要求を送るためのクラス
 * 各アドオンが AddonInitializeReceive を準備しておく必要があります
 *
 * A class that sends registration requests from the router to each addon
 * Each addon must prepare AddonInitializeReceive
 */
export class AddonInitializeRequest {
    private constructor(private readonly addonInitializer: AddonInitializer) {}

    public static create(addonInitializer: AddonInitializer): AddonInitializeRequest {
        return new AddonInitializeRequest(addonInitializer);
    }

    public handleWorldLoad = (ev: WorldLoadAfterEvent): void => {
        this.sendRequest();
    };

    private sendRequest(): void {
        /**
         * アドオンの数を数えるためのscoreboardを用意しておく
         * Prepare a scoreboard to count the number of addons
         */
        ScoreboardManager.ensureObjective(SCOREBOARD_NAMES.ADDON_COUNTER).setScore(
            SCOREBOARD_NAMES.ADDON_COUNTER,
            0,
        );

        /**
         * scriptEventを送信して、各アドオンに登録要求を送る
         * Send a scriptEvent to request registration from each addon
         */
        ConsoleManager.log("World loaded. Sending core initialization request...");
        system.sendScriptEvent(
            SCRIPT_EVENT_IDS.BEHAVIOR_REGISTRATION_REQUEST,
            SCRIPT_EVENT_MESSAGES.NONE,
        );
    }
}
