import type { AddonProperties } from "@kairo-js/properties";

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
            minor: 0,
            patch: 0,
            prerelease: "beta.1",
        },
        min_engine_version: { major: 1, minor: 21, patch: 132 },
    },
    minecraftDependencies: [
        {
            module_name: "@minecraft/server",
            version: "2.7.0",
        },
        {
            module_name: "@minecraft/server-ui",
            version: "2.0.0",
        },
    ],
    optionalDependencies: {
        "kairo-database": "^1.0.0",
    },
    dependencies: {
        /**
         * id: version (string) // "kairo": "1.0.0"
         */
    },
    tags: ["official", "stable"],
};
