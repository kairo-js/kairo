import type { Player } from "@minecraft/server";
import type { AddonData } from "../AddonManager";
import type { AddonRequireValidator } from "./AddonRequireValidator";
import { ErrorManager } from "../../utils/ErrorManager";
import { KAIRO_TRANSLATE_IDS } from "../../constants/translate";
import { MessageFormData } from "@minecraft/server-ui";
import { VERSION_KEYWORDS } from "../../constants/version_keywords";
import { VersionManager } from "../../utils/VersionManager";
import { ConsoleManager } from "../../utils/ConsoleManager";

export class AddonRequireValidatorForActivation {
    private readonly activationQueue: Map<string, { addonData: AddonData; version: string }> =
        new Map();
    private readonly visited: Map<string, string> = new Map();
    private readonly visiting: Set<string> = new Set();

    private constructor(private readonly requireValidator: AddonRequireValidator) {}

    public static create(
        requireValidator: AddonRequireValidator,
    ): AddonRequireValidatorForActivation {
        return new AddonRequireValidatorForActivation(requireValidator);
    }

    public async validateRequiredAddonsForActivation(
        player: Player,
        addonData: AddonData,
        newVersion: string,
    ): Promise<string[]> {
        this.clearActivationQueue();
        const isResolved = this.resolveRequiredAddonsForActivation(addonData, newVersion);
        try {
            if (!isResolved) {
                ErrorManager.showErrorDetails(player, "kairo_resolve_for_activation_error");
                return [];
            }

            if (this.activationQueue.size > 1) {
                const rootAddonId = addonData.id;
                const queueAddonList = Array.from(this.activationQueue.values())
                    .filter(({ addonData }) => addonData.id !== rootAddonId)
                    .map(({ addonData, version }) => `・${addonData.name} (ver.${version})`)
                    .join("\n");
                const messageForm = new MessageFormData()
                    .title({ translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_TITLE })
                    .body({
                        translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_ACTIVATION_BODY,
                        with: [queueAddonList],
                    })
                    .button1({
                        translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_ACTIVE_CONFIRM,
                    })
                    .button2({ translate: KAIRO_TRANSLATE_IDS.ADDON_SETTING_REQUIRED_CANCEL });
                const { selection, canceled } = await messageForm.show(player);
                if (canceled || selection === undefined || selection === 1) {
                    return [];
                }
                return [...this.activationQueue.keys()];
            }
            return [addonData.id];
        } finally {
            this.clearActivationQueue();
        }
    }

    private resolveRequiredAddonsForActivation(addonData: AddonData, newVersion: string): boolean {
        const newActiveVersion =
            newVersion === VERSION_KEYWORDS.LATEST
                ? this.requireValidator.getLatestVersion(addonData.id)
                : newVersion;
        if (newActiveVersion === undefined) return false;

        if (this.visited.has(addonData.id)) {
            const visitedVersion = this.visited.get(addonData.id);
            if (visitedVersion && VersionManager.compare(visitedVersion, newActiveVersion) >= 0) {
                return true;
            }
        }

        if (this.visiting.has(addonData.id)) {
            ConsoleManager.error(`Cycle detected while activating: ${addonData.id}`);
            return false;
        }
        this.visiting.add(addonData.id);

        try {
            const newActiveVersionData = addonData.versions[newActiveVersion];
            if (!newActiveVersionData) return false;
            const requiredAddons = newActiveVersionData.requiredAddons ?? {};

            const addonsData = this.requireValidator.getAddonsData();
            for (const [id, version] of Object.entries(requiredAddons)) {
                const requiredAddon = addonsData.get(id);
                if (!requiredAddon) {
                    /**
                     * 登録時に前提アドオンがそもそも登録されていない場合ははじいているので、
                     * ここでrequiredAddonが壊れている場合、登録されていないわけではない
                     * Since addons that lack required dependencies are already rejected at registration,
                     * if requiredAddons is corrupted here, it does not mean the addon was not registered
                     */
                    ConsoleManager.error(
                        `Addon data corrupted: parent=${addonData.id}@${newActiveVersion}, missing required=${id}@${version}`,
                    );
                    return false;
                }

                if (!this.isAddonActive(requiredAddon, version)) {
                    const requireLatestStableVersion =
                        this.requireValidator.getLatestPreferStableVersion(id);
                    if (!requireLatestStableVersion) {
                        ConsoleManager.error(
                            `Addon data corrupted: missing required=${id}@${version}`,
                        );
                        return false;
                    }

                    if (VersionManager.compare(requireLatestStableVersion, version) < 0) {
                        const requireLatestVersion = this.requireValidator.getLatestVersion(id);
                        if (
                            !requireLatestVersion ||
                            VersionManager.compare(requireLatestVersion, version) < 0
                        ) {
                            ConsoleManager.error(
                                `Addon data corrupted: missing required=${id}@${version}`,
                            );
                            return false;
                        }

                        const isResolved = this.resolveRequiredAddonsForActivation(
                            requiredAddon,
                            requireLatestVersion,
                        );
                        if (!isResolved) return false;
                    } else {
                        const isResolved = this.resolveRequiredAddonsForActivation(
                            requiredAddon,
                            requireLatestStableVersion,
                        );
                        if (!isResolved) return false;
                    }
                }
            }

            const prev = this.activationQueue.get(addonData.id);
            if (!prev || VersionManager.compare(newActiveVersion, prev.version) > 0) {
                this.activationQueue.set(addonData.id, { addonData, version: newActiveVersion });
            }
            this.visited.set(addonData.id, newActiveVersion);
            return true;
        } finally {
            this.visiting.delete(addonData.id);
        }
    }

    private isAddonActive(addonData: AddonData, version: string): boolean {
        const queued = this.activationQueue.get(addonData.id);
        if (queued && VersionManager.compare(queued.version, version) >= 0) return true;

        if (!addonData) return false;
        if (!addonData.isActive) return false;

        return VersionManager.compare(addonData.activeVersion, version) >= 0;
    }

    private clearActivationQueue() {
        this.activationQueue.clear();
        this.visited.clear();
        this.visiting.clear();
    }
}
