import { system, type ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import type { AddonManager } from "../AddonManager";
import { SCRIPT_EVENT_ID_PREFIX, SCRIPT_EVENT_ID_SUFFIX } from "../../constants/scriptevent";

export class AddonRouter {
    private constructor(private readonly addonManager: AddonManager) {}

    public static create(addonManager: AddonManager): AddonRouter {
        return new AddonRouter(addonManager);
    }

    public handleScriptEvent = (ev: ScriptEventCommandMessageAfterEvent): void => {
        const { id, message } = ev;
        const splitId = id.split(":");
        if (splitId[0] !== SCRIPT_EVENT_ID_PREFIX.KAIRO) return;

        const suffix = splitId[1];
        if (suffix === undefined) return;

        if (suffix === SCRIPT_EVENT_ID_SUFFIX.BROADCAST) {
            this.sendToAllAddons(message);
            return;
        }

        const addonData = this.addonManager.getAddonsData().get(suffix);
        if (addonData === undefined) return;
        if (!addonData.isActive) return;

        const activeVersionData = addonData.versions[addonData.activeVersion];
        if (!activeVersionData) return;

        system.sendScriptEvent(
            `${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${activeVersionData.sessionId}`,
            message,
        );
    };

    private sendToAllAddons(message: string): void {
        const addons = this.addonManager.getAddonsData();

        for (const [_, addonData] of addons) {
            if (!addonData.isActive) continue;

            const versionData = addonData.versions[addonData.activeVersion];
            if (!versionData) continue;

            const sessionId = versionData.sessionId;

            system.sendScriptEvent(`${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${sessionId}`, message);
        }
    }
}
