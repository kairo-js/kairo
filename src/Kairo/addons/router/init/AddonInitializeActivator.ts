import { VERSION_KEYWORDS } from "../../../constants/version_keywords";
import { VersionManager } from "../../../utils/VersionManager";
import type { AddonData, RegistrationState } from "../../AddonManager";
import type { AddonProperty } from "../../AddonPropertyManager";
import type { AddonInitializer } from "./AddonInitializer";

/**
 * pendingRegistration と AddonData は持ってるもの同じで冗長に見えるけど、
 * おおもとの AddonData を壊したくないからあえて分けてる
 */
interface PendingData {
    id: string;
    selectedVersion: string;
    isActive: boolean;
    versions: {
        [version: string]: {
            isRegistered: boolean;
            requiredAddons?: Record<string, string>;
        };
    };
}

export class AddonInitializeActivator {
    private readonly pendingRegistration: Map<string, PendingData> = new Map();
    private readonly canRegisterAddons: Set<string> = new Set();
    private readonly visiting: Set<string> = new Set();

    private constructor(private readonly addonInitializer: AddonInitializer) {}

    public static create(addonInitializer: AddonInitializer): AddonInitializeActivator {
        return new AddonInitializeActivator(addonInitializer);
    }

    public initActivateAddons(addons: AddonProperty[]): void {
        const addonRecords = this.addonInitializer.getAddonRecords();

        Object.entries(addonRecords).forEach(([id, record]) => {
            /**
             * 普通に record ごと渡せばいいと思うけど、recordは recordsとして定義されてて、変えるのが面倒で、
             * 誰か直してください
             */
            this.initAddonData(
                id,
                record.name,
                record.description,
                record.selectedVersion,
                record.versions,
                record.isActive,
            );
        });

        this.enqueuePendingRegistration(addons);
        this.updateAddonRegistrationState(addons);

        this.addonInitializer.getAddonsData().forEach((data, id) => {
            this.activateSelectedVersion(id);

            data.isEditable = !!Object.entries(data.versions).find(([version, data]) => {
                return data.isRegistered && data.registrationState === "registered";
            });

            if (data.isActive) {
                const activeVersionData = data.versions[data.activeVersion];
                const sessionId = activeVersionData?.sessionId;
                if (!sessionId) return;
                this.addonInitializer.sendActiveRequest(sessionId);
            }
        });

        this.pendingRegistration.clear();
        this.canRegisterAddons.clear();
        this.visiting.clear();
    }

    private initAddonData(
        id: string,
        name: string,
        description: [string, string],
        selectedVersion: string,
        versions: string[],
        isActive: boolean,
    ): void {
        const sortedVersions = versions.sort((a, b) => VersionManager.compare(b, a));

        const addonData: AddonData = {
            id,
            name,
            description,
            isActive,
            isEditable: false,
            selectedVersion,
            activeVersion: "",
            versions: {},
        };
        sortedVersions.forEach((version) => {
            addonData.versions[version] = {
                isRegistered: false,
                registrationState: "unregistered",
            };
        });
        this.addonInitializer.getAddonsData().set(id, addonData);

        const pendingData: PendingData = {
            id,
            isActive,
            selectedVersion,
            versions: {},
        };
        this.pendingRegistration.set(id, pendingData);
    }

    private enqueuePendingRegistration(addons: AddonProperty[]): void {
        addons.forEach((addon: AddonProperty) => {
            const pendingData = this.pendingRegistration.get(addon.id);
            if (!pendingData) return;

            const version = VersionManager.toVersionString(addon.version);
            pendingData.versions[version] = {
                isRegistered: true,
                requiredAddons: addon.requiredAddons ?? {},
            };
        });
    }

    private updateAddonRegistrationState(addons: AddonProperty[]): void {
        addons.forEach((addon: AddonProperty) => {
            const addonData = this.addonInitializer.getAddonsData().get(addon.id);
            if (!addonData) return;

            const version = VersionManager.toVersionString(addon.version);
            const isRegisterable = this.checkRequiredAddons(
                addon.id,
                version,
                addon.requiredAddons,
            );
            let registrationState: RegistrationState = isRegisterable
                ? "registered"
                : "missing_requiredAddons";

            addonData.versions[version] = {
                isRegistered: isRegisterable,
                canInitActivate: this.checkRequiredAddonsForActivation(addon.requiredAddons),
                registrationState,
                sessionId: addon.sessionId,
                tags: addon.tags,
                dependencies: addon.dependencies,
                requiredAddons: addon.requiredAddons,
            };
        });
    }

    private checkRequiredAddons(
        id: string,
        version: string,
        requiredAddons: Record<string, string>,
    ): boolean {
        const selfKey = this.makeKey(id, version);
        if (this.canRegisterAddons.has(selfKey)) return true;

        if (this.visiting.has(selfKey)) return false;
        this.visiting.add(selfKey);

        try {
            for (const [requiredId, requiredVersion] of Object.entries(requiredAddons)) {
                const requiredAddonData = this.pendingRegistration.get(requiredId);
                if (!requiredAddonData) return false;

                const isRequiredRegistered = Object.entries(requiredAddonData.versions).some(
                    ([candidateVersion, data]) => {
                        const requiredAddons = data.requiredAddons;
                        if (!requiredAddons) return false;
                        if (!data.isRegistered) return false;

                        return (
                            VersionManager.compare(candidateVersion, requiredVersion) >= 0 &&
                            this.checkRequiredAddons(
                                requiredAddonData.id,
                                candidateVersion,
                                requiredAddons,
                            )
                        );
                    },
                );

                if (!isRequiredRegistered) return false;
            }
            this.canRegisterAddons.add(selfKey);
            return true;
        } finally {
            this.visiting.delete(selfKey);
        }
    }

    private checkRequiredAddonsForActivation(requiredAddons: Record<string, string>): boolean {
        for (const [requiredId, requiredVersion] of Object.entries(requiredAddons)) {
            const requiredAddonData = this.pendingRegistration.get(requiredId);
            if (!requiredAddonData) return false;
            if (!requiredAddonData.isActive) return false;

            const requiredSelectedVersion =
                requiredAddonData.selectedVersion === VERSION_KEYWORDS.LATEST
                    ? this.getLatestPreferStableVersionInPending(requiredId)
                    : requiredAddonData.selectedVersion;
            if (!requiredSelectedVersion) return false;

            const isVersionGreater =
                VersionManager.compare(requiredSelectedVersion, requiredVersion) >= 0;
            if (!isVersionGreater) return false;
        }
        return true;
    }

    private makeKey(id: string, version: string) {
        return `${id}@${version}`;
    }

    private getLatestPreferStableVersionInPending(id: string): string | undefined {
        const addonData = this.pendingRegistration.get(id);
        if (!addonData) return undefined;

        const sorted = Object.keys(addonData.versions)
            .filter((v) => addonData.versions[v])
            .sort((a, b) => VersionManager.compare(b, a));

        if (sorted.length === 0) return undefined;

        const stable = sorted.find((v) => !VersionManager.fromString(v).prerelease);
        return stable ?? sorted[0]!;
    }

    private activateLatestVersion(id: string): void {
        const addonData = this.addonInitializer.getAddonsData().get(id);
        if (!addonData) return;

        const sorted = Object.keys(addonData.versions)
            .filter(
                (v) =>
                    addonData.versions[v]?.isRegistered && addonData.versions[v]?.canInitActivate,
            )
            .sort((a, b) => VersionManager.compare(b, a));

        if (sorted.length === 0) return;

        const stable = sorted.find((v) => !VersionManager.fromString(v).prerelease);
        const activeVersion = stable ?? sorted[0]!;

        this.initActivation(addonData, activeVersion);
    }

    private activateSelectedVersion(id: string): void {
        const addonData = this.addonInitializer.getAddonsData().get(id);
        if (!addonData) return;
        if (!addonData.isActive) return;

        if (addonData.selectedVersion === VERSION_KEYWORDS.LATEST) {
            this.activateLatestVersion(id);
            return;
        }

        const selectedVersion = Object.keys(addonData.versions).find(
            (v) =>
                v === addonData.selectedVersion &&
                addonData.versions[v]?.isRegistered &&
                addonData.versions[v]?.canInitActivate,
        );

        if (!selectedVersion) return;

        this.initActivation(addonData, selectedVersion);
    }

    private initActivation(addonData: AddonData, activeVersion: string): void {
        addonData.activeVersion = activeVersion;
        addonData.isActive = true;
    }
}
