import { system, world } from "@minecraft/server";
import type { AddonProperty } from "../../AddonPropertyManager";
import type { AddonInitializer } from "./AddonInitializer";
import { SCOREBOARD_NAMES } from "../../../constants/scoreboard";
import { SCRIPT_EVENT_IDS, SCRIPT_EVENT_MESSAGES } from "../../../constants/scriptevent";

/**
 * アドオンの properties を参照して、ルーターに応答するためのクラス
 * propertiesの必要な部分を抜粋して、JSON.stringifyで送信します
 *
 * A class that responds to the router by referencing the addon's properties
 * Extracts the necessary parts of the properties and sends them using JSON.stringify
 */
export class AddonInitializeResponse {
    private constructor(private readonly addonInitializer: AddonInitializer) {}

    public static create(addonInitializer: AddonInitializer): AddonInitializeResponse {
        return new AddonInitializeResponse(addonInitializer);
    }

    /**
     * scoreboard を使って登録用の識別番号も送信しておく
     * Also send the registration ID using the scoreboard
     */
    public sendResponse(addonProperty: AddonProperty): void {
        system.sendScriptEvent(
            SCRIPT_EVENT_IDS.BEHAVIOR_REGISTRATION_RESPONSE,
            JSON.stringify([
                addonProperty,
                world.scoreboard
                    .getObjective(SCOREBOARD_NAMES.ADDON_COUNTER)
                    ?.getScore(SCOREBOARD_NAMES.ADDON_COUNTER) ?? 0,
            ]),
        );
    }

    public sendInitializationCompleteResponse(): void {
        system.sendScriptEvent(
            SCRIPT_EVENT_IDS.BEHAVIOR_INITIALIZATION_COMPLETE_RESPONSE,
            SCRIPT_EVENT_MESSAGES.NONE,
        );
    }
}
