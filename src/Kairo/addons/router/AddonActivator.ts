import { Player, system, world } from "@minecraft/server";
import type { AddonData, AddonManager } from "../AddonManager";
import { SCRIPT_EVENT_ID_PREFIX, SCRIPT_EVENT_MESSAGES } from "../../constants/scriptevent";
import { KAIRO_TRANSLATE_IDS } from "../../constants/translate";
import { AddonRequireValidator } from "./AddonRequireValidator";
import { VERSION_KEYWORDS } from "../../constants/version_keywords";
import { VersionManager } from "../../utils/VersionManager";

export class AddonActivator {
    private readonly addonRequireValidator: AddonRequireValidator;

    private constructor(private readonly addonManager: AddonManager) {
        this.addonRequireValidator = AddonRequireValidator.create(this);
    }

    public static create(addonManager: AddonManager): AddonActivator {
        return new AddonActivator(addonManager);
    }

    public async activateAddon(
        player: Player,
        addonData: AddonData,
        version: string,
    ): Promise<void> {
        const activateAddonIds =
            await this.addonRequireValidator.validateRequiredAddonsForActivation(
                player,
                addonData,
                version,
            );
        if (activateAddonIds.length === 0) return;

        const addonsData = this.getAddonsData();
        for (const id of activateAddonIds) {
            const data = addonsData.get(id);
            if (data) {
                data.isActive = true;
                if (data.id === addonData.id) data.selectedVersion = version;
                else data.selectedVersion = VERSION_KEYWORDS.LATEST;

                const newActiveVersion =
                    data.selectedVersion === VERSION_KEYWORDS.LATEST
                        ? this.addonManager.getLatestPreferStableVersion(data.id)
                        : data.selectedVersion;
                if (newActiveVersion === undefined) continue;

                /**
                 * 大きくするなら、過去バージョンは問答無用に無効化して良い
                 * 小さくするなら、deactivationの依存も検証する必要がある
                 */
                const compare = VersionManager.compare(data.activeVersion, newActiveVersion);
                if (compare < 0) {
                    const oldActiveVersionData = data.versions[data.activeVersion];
                    const oldSessionId = oldActiveVersionData?.sessionId;
                    if (oldSessionId) this.sendDeactiveRequest(oldSessionId);
                } else if (compare > 0) {
                    const deactivateAddonIds =
                        await this.addonRequireValidator.validateRequiredAddonsForDeactivation(
                            player,
                            data,
                            newActiveVersion,
                        );
                    this.deactivateAddons(deactivateAddonIds);
                }

                data.activeVersion = newActiveVersion;
                const newActiveVersionData = data.versions[data.activeVersion];
                const newSessionId = newActiveVersionData?.sessionId;
                if (newSessionId) this.sendActiveRequest(newSessionId);

                world.sendMessage({
                    translate: KAIRO_TRANSLATE_IDS.ADDON_ACTIVE,
                    with: [data.name, newActiveVersion],
                });
                this.addonManager.saveAddon(data);
            }
        }
    }

    public async deactivateAddon(player: Player, addonData: AddonData): Promise<void> {
        const deactivateAddonIds =
            await this.addonRequireValidator.validateRequiredAddonsForDeactivation(
                player,
                addonData,
            );
        this.deactivateAddons(deactivateAddonIds);
    }

    private deactivateAddons(addonIds: string[]): void {
        const addonsData = this.getAddonsData();
        for (const id of addonIds) {
            const data = addonsData.get(id);
            if (data) {
                data.isActive = false;

                const activeVersionData = data.versions[data.activeVersion];
                const sessionId = activeVersionData?.sessionId;
                if (sessionId) this.sendDeactiveRequest(sessionId);

                world.sendMessage({
                    translate: KAIRO_TRANSLATE_IDS.ADDON_DEACTIVE,
                    with: [data.name],
                });
                this.addonManager.saveAddon(data);
            }
        }
    }

    public getAddonsData(): Map<string, AddonData> {
        return this.addonManager.getAddonsData();
    }

    public sendActiveRequest(sessionId: string): void {
        system.sendScriptEvent(
            `${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${sessionId}`,
            SCRIPT_EVENT_MESSAGES.ACTIVATE_REQUEST,
        );
    }

    public sendDeactiveRequest(sessionId: string): void {
        system.sendScriptEvent(
            `${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${sessionId}`,
            SCRIPT_EVENT_MESSAGES.DEACTIVATE_REQUEST,
        );
    }

    public getLatestPreferStableVersion(id: string): string | undefined {
        return this.addonManager.getLatestPreferStableVersion(id);
    }

    public getLatestVersion(id: string): string | undefined {
        return this.addonManager.getLatestVersion(id);
    }
}
