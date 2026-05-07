import { MinecraftModule, SupportedTag, type AddonProperties } from "@kairo-js/router";

export const properties: AddonProperties = {
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
        min_engine_version: { major: 1, minor: 21, patch: 132 },
    },
    dependencies: [
        {
            module_name: MinecraftModule.Server,
            version: "2.4.0",
        },
        {
            module_name: MinecraftModule.ServerUi,
            version: "2.0.0",
        },
    ],
    /** 前提アドオン */
    requiredAddons: {
        /**
         * id: version (string) // "kairo": "1.0.0"
         */
    },
    tags: [SupportedTag.Official, SupportedTag.Stable],
};
