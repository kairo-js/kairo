export const properties: KairoAddonProperties = {
    id: "kairo", //# // a-z & 0-9 - _
    metadata: {
        authors: ["shizuku86"],
    },
    header: {
        name: "Kairo",
        description:
            "Enables communication between multiple behavior packs by leveraging the ScriptAPI as a communication layer.",
        version: {
            major: 1,
            minor: 1,
            patch: 0,
            // prerelease: "preview.1",
            // build: "abc123",
        },
        min_engine_version: [1, 21, 132],
    },
    dependencies: [
        {
            module_name: "@minecraft/server",
            version: "2.4.0",
        },
        {
            module_name: "@minecraft/server-ui",
            version: "2.0.0",
        },
    ],
    /** 前提アドオン */
    requiredAddons: {
        /**
         * id: version (string) // "kairo": "1.0.0"
         */
    },
    tags: ["official", "stable"],
};

export type SemVer = {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease?: string;
    readonly build?: string;
};

export type EngineVersion = [number, number, number];

export type ManifestDependency = {
    readonly module_name: "@minecraft/server" | "@minecraft/server-ui";
    readonly version: string;
};

export type AddonHeader = {
    readonly name: string;
    readonly description: string;
    readonly version: SemVer;
    readonly min_engine_version: EngineVersion;
};

export type AddonMetadata = {
    readonly authors?: string[];
    readonly url?: string;
    readonly license?: string;
};

export type RequiredAddons = {
    readonly [addonId: string]: string;
};

export const SupportedTagValues = ["official", "approved", "stable", "experimental"] as const;
export type SupportedTag = (typeof SupportedTagValues)[number];

export type KairoAddonProperties = {
    readonly id: string;
    readonly metadata?: AddonMetadata;
    readonly header: AddonHeader;
    readonly dependencies?: ManifestDependency[];
    readonly requiredAddons?: RequiredAddons;
    readonly tags?: SupportedTag[];
};
