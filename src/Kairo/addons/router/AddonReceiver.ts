import { system, type ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import type { AddonManager } from "../AddonManager";
import {
    SCRIPT_EVENT_COMMAND_TYPES,
    SCRIPT_EVENT_ID_PREFIX,
    SCRIPT_EVENT_MESSAGES,
} from "../../constants/scriptevent";
import { ConsoleManager } from "../../utils/ConsoleManager";
import { KairoUtils, type KairoCommand } from "../../utils/KairoUtils";
import { properties } from "../../../properties";

export class AddonReceiver {
    private constructor(private readonly addonManager: AddonManager) {}

    public static create(addonManager: AddonManager): AddonReceiver {
        return new AddonReceiver(addonManager);
    }

    public handleScriptEvent = async (ev: ScriptEventCommandMessageAfterEvent): Promise<void> => {
        const { id, message } = ev;

        const addonProperty = this.addonManager.getSelfAddonProperty();
        if (id !== `${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${addonProperty.sessionId}`) return;

        if (this.addonManager.isActive === false) {
            if (message !== SCRIPT_EVENT_MESSAGES.ACTIVATE_REQUEST) return;
        }

        switch (message) {
            case SCRIPT_EVENT_MESSAGES.ACTIVATE_REQUEST:
                this.addonManager._activateAddon();
                break;
            case SCRIPT_EVENT_MESSAGES.DEACTIVATE_REQUEST:
                this.addonManager._deactivateAddon();
                break;
            default:
                let data: any;
                try {
                    data = JSON.parse(message);
                } catch (e) {
                    ConsoleManager.warn(`[ScriptEventReceiver] Invalid JSON: ${message}`);
                    return;
                }

                if (typeof data.sourceAddonId !== "string") return;
                if (typeof data.commandType !== "string") return;

                if (data.ackFor && typeof data.ackFor === "string") {
                    KairoUtils.resolvePendingRequest(data.ackFor, data.response);
                    return;
                }

                if (typeof data.commandId !== "string") return;
                if (!data || typeof data !== "object") return;

                const command: KairoCommand = data;

                const response = await this.addonManager._scriptEvent(command);

                system.sendScriptEvent(
                    `${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${command.sourceAddonId}`,
                    JSON.stringify({
                        sourceAddonId: properties.id,
                        commandType: SCRIPT_EVENT_COMMAND_TYPES.KAIRO_ACK,
                        ackFor: command.commandId,
                        response,
                    }),
                );
                break;
        }
    };
}
