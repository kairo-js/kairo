import type { Player } from "@minecraft/server";
import type { AddonData } from "../AddonManager";
import type { AddonRequireValidator } from "./AddonRequireValidator";
import { VersionManager } from "../../utils/VersionManager";
import { ConsoleManager } from "../../utils/ConsoleManager";
import { ErrorManager } from "../../utils/ErrorManager";
import { MessageFormData } from "@minecraft/server-ui";
import { KAIRO_TRANSLATE_IDS } from "../../constants/translate";

export class AddonRequireValidatorForDeactivation {
    private readonly deactivationQueue: Map<string, AddonData> = new Map();
    private readonly visited: Set<string> = new Set();
    private readonly visiting: Set<string> = new Set();

    private constructor(private readonly requireValidator: AddonRequireValidator) {}

    public static create(
        requireValidator: AddonRequireValidator,
    ): AddonRequireValidatorForDeactivation {
        return new AddonRequireValidatorForDeactivation(requireValidator);
    }

    /**
     * length = 0: cancel or error
     * length > 0: success
     */
    public async validateRequiredAddonsForDeactivation(
        player: Player,
        addonData: AddonData,
        newVersion: string = addonData.activeVersion,
    ): Promise<string[]> {
        this.clearDeactivationQueue();
        const isResolved = this.resolveRequiredAddonsForDeactivation(addonData, newVersion);
        try {
            if (!isResolved) {
                ErrorManager.showErrorDetails(player, "kairo_resolve_for_deactivation_error");
                return [];
            }

            if (this.deactivationQueue.size > 1) {
                const rootAddonId = addonData.id;
                const queueAddonList = Array.from(this.deactivationQueue.values())
                    .filter((addonData) => addonData.id !== rootAddonId)
                    .map((addonData) => `・${addonData.name} (ver.${addonData.activeVersion})`)
                    .join("\n");
                const messageForm = new MessageFormData()
                    .title({ translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_TITLE })
                    .body({
                        translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_DEACTIVATION_BODY,
                        with: [queueAddonList],
                    })
                    .button1({
                        translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_DEACTIVE_CONFIRM,
                    })
                    .button2({ translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_CANCEL });
                const { selection, canceled } = await messageForm.show(player);
                if (canceled || selection === undefined || selection === 1) {
                    return [];
                }
                return [...this.deactivationQueue.keys()];
            }
            return [addonData.id];
        } finally {
            this.clearDeactivationQueue();
        }
    }

    private resolveRequiredAddonsForDeactivation(
        addonData: AddonData,
        newVersion: string = addonData.activeVersion,
    ): boolean {
        /**
         * 新しいバージョンを有効にする場合、依存関係を調べる必要はない
         */
        if (VersionManager.compare(addonData.activeVersion, newVersion) < 0) {
            this.visited.add(addonData.id);
            return true;
        }

        if (this.visited.has(addonData.id)) return true;

        if (this.isInactive(addonData)) {
            this.visited.add(addonData.id);
            return true;
        }

        if (this.visiting.has(addonData.id)) {
            ConsoleManager.error(`Cycle detected while deactivating: ${addonData.id}`);
            return false;
        }
        this.visiting.add(addonData.id);

        try {
            const addonsData = this.requireValidator.getAddonsData();

            for (const data of addonsData.values()) {
                if (this.isInactive(data)) continue;

                const activeVersionData = data.versions[data.activeVersion];
                const requiredAddons = activeVersionData?.requiredAddons;
                if (!requiredAddons) {
                    /**
                     * requiredAddonsが壊れている場合は不具合なので、処理を中断してエラーを表示する
                     */
                    ConsoleManager.error(
                        `Addon data corrupted: ${data.id}@${data.activeVersion}, missing required addons`,
                    );
                    return false;
                }

                const requiredVersion = requiredAddons[addonData.id];
                if (requiredVersion !== undefined) {
                    if (newVersion === addonData.activeVersion) {
                        /**
                         * 普通に無効化する場合
                         */
                        const isResolved = this.resolveRequiredAddonsForDeactivation(data);
                        if (!isResolved) return false;
                    } else if (VersionManager.compare(newVersion, requiredVersion) < 0) {
                        /**
                         * 依存されているバージョンよりも小さくする場合は、依存元を無効化する必要がある
                         */
                        const isResolved = this.resolveRequiredAddonsForDeactivation(data);
                        if (!isResolved) return false;
                    }
                }
            }

            this.visited.add(addonData.id);
            this.deactivationQueue.set(addonData.id, addonData);
            return true;
        } finally {
            this.visiting.delete(addonData.id);
        }
    }

    private isInactive(addonData: AddonData): boolean {
        const queued = this.deactivationQueue.has(addonData.id);
        if (queued) return true;

        if (!addonData) return false;
        return !addonData.isActive;
    }

    private clearDeactivationQueue() {
        this.deactivationQueue.clear();
        this.visited.clear();
        this.visiting.clear();
    }
}
