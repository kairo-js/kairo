import type { AddonProperty } from "../AddonPropertyManager";
import type { AddonInitializer } from "../router/init/AddonInitializer";
import { DynamicPropertyStorage } from "./DynamicPropertyStorage";
import { VERSION_KEYWORDS } from "../../constants/version_keywords";
import type { AddonData } from "../AddonManager";
import { STORAGE_KEYWORDS } from "../../constants/storage";
import { VersionManager } from "../../utils/VersionManager";

export interface AddonRecords {
    [id: string]: {
        name: string;
        description: [string, string];
        selectedVersion: string;
        versions: string[];
        isActive: boolean;
    };
}

export class AddonRecord {
    private constructor(private readonly addonInitializer: AddonInitializer) {}

    public static create(addonInitializer: AddonInitializer): AddonRecord {
        return new AddonRecord(addonInitializer);
    }

    public saveAddon(addonData: AddonData): void {
        const addonRecords: AddonRecords = this.loadAddons();
        const { id, name } = addonData;

        if (!addonRecords[id]) {
            addonRecords[id] = {
                name: name,
                description: ["0.0.0", ""],
                selectedVersion: VERSION_KEYWORDS.LATEST,
                versions: Object.keys(addonData?.versions),
                isActive: true,
            };
        }

        addonRecords[id].description = addonData.description;
        addonRecords[id].selectedVersion = addonData.selectedVersion;
        addonRecords[id].isActive = addonData.isActive;

        DynamicPropertyStorage.save(STORAGE_KEYWORDS.ADDON_RECORDS, addonRecords);
    }

    public saveAddons(addons: AddonProperty[]): void {
        const addonRecords: AddonRecords = this.loadAddons();

        addons.forEach((addon) => {
            const { id, name, version } = addon;
            const vStr = VersionManager.toVersionString(version);

            if (!addonRecords[id]) {
                addonRecords[id] = {
                    name: name,
                    description: ["0.0.0", ""],
                    selectedVersion: VERSION_KEYWORDS.LATEST,
                    versions: [],
                    isActive: true,
                };
            }

            if (VersionManager.compare(addonRecords[id].description[0], vStr) === -1) {
                addonRecords[id].description[0] = vStr;
                addonRecords[id].description[1] = addon.description;
            }

            addonRecords[id].versions.push(vStr);
        });

        DynamicPropertyStorage.save(STORAGE_KEYWORDS.ADDON_RECORDS, addonRecords);
    }

    public loadAddons(): AddonRecords {
        return DynamicPropertyStorage.load(STORAGE_KEYWORDS.ADDON_RECORDS) as AddonRecords;
    }
}
