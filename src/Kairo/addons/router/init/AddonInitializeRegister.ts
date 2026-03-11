import { system, world, type ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import type { AddonProperty } from "../../AddonPropertyManager";
import type { AddonInitializer } from "./AddonInitializer";
import { ConsoleManager } from "../../../utils/ConsoleManager";
import { VersionManager } from "../../../utils/VersionManager";
import { SCOREBOARD_NAMES } from "../../../constants/scoreboard";
import { SCRIPT_EVENT_IDS } from "../../../constants/scriptevent";

/**
 * 応答したアドオンを登録するためのクラス
 *
 * A class responsible for registering addons that have responded.
 */
export class AddonInitializeRegister {
    private readonly registeredAddons: Map<string, AddonProperty> = new Map();

    private _resolveReady: (() => void) | null = null;
    public readonly ready: Promise<void> = new Promise((resolve) => {
        this._resolveReady = resolve;
    });

    private initializationCompleteCounter: number = 0;

    private constructor(private readonly addonInitializer: AddonInitializer) {}
    public static create(addonInitializer: AddonInitializer): AddonInitializeRegister {
        return new AddonInitializeRegister(addonInitializer);
    }

    public handleScriptEventReceive = (ev: ScriptEventCommandMessageAfterEvent): void => {
        const { id, message } = ev;

        const addonCount: number =
            world.scoreboard
                .getObjective(SCOREBOARD_NAMES.ADDON_COUNTER)
                ?.getScore(SCOREBOARD_NAMES.ADDON_COUNTER) ?? 0;

        switch (id) {
            case SCRIPT_EVENT_IDS.BEHAVIOR_REGISTRATION_RESPONSE:
                this.add(message);
                break;
            case SCRIPT_EVENT_IDS.BEHAVIOR_INITIALIZATION_COMPLETE_RESPONSE:
                this.initializationCompleteCounter += 1;

                ConsoleManager.log(
                    `${this.initializationCompleteCounter} / ${addonCount} addons have completed initialization.`,
                );
                if (this.initializationCompleteCounter === addonCount) {
                    this._resolveReady?.();
                    this._resolveReady = null;
                    world.scoreboard.removeObjective(SCOREBOARD_NAMES.ADDON_COUNTER);
                    ConsoleManager.log("All addons initialized. Ready!");
                }
                break;
            default:
                break;
        }
    };

    private add(message: string): void {
        const [addonProperties, registrationNum]: [AddonProperty, number] = JSON.parse(message);

        /**
         * Idが重複している場合は、再度IDを要求する
         * If the ID is duplicated, request a new ID again
         */
        if (this.registeredAddons.has(addonProperties.sessionId)) {
            system.sendScriptEvent(
                SCRIPT_EVENT_IDS.REQUEST_RESEED_SESSION_ID,
                registrationNum.toString(),
            );
            return;
        }
        ConsoleManager.log(
            `Registering addon: ${addonProperties.name} - ver.${VersionManager.toVersionString(addonProperties.version)}`,
        );
        this.registeredAddons.set(addonProperties.sessionId, addonProperties);
        system.sendScriptEvent(
            SCRIPT_EVENT_IDS.BEHAVIOR_INITIALIZE_REQUEST,
            registrationNum.toString(),
        );
    }

    public has(sessionId: string): boolean {
        return this.registeredAddons.has(sessionId);
    }

    public get(sessionId: string): AddonProperty {
        return this.registeredAddons.get(sessionId) as AddonProperty;
    }

    public getAll(): AddonProperty[] {
        return Array.from(this.registeredAddons.values());
    }
}
