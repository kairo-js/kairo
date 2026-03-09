import esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["scripts/index.ts", "scripts/properties.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    outdir: "BP/scripts",
    sourcemap: false,

    external: [
        "@minecraft/common",
        "@minecraft/debug-utilities",
        "@minecraft/diagnostics",
        "@minecraft/server",
        "@minecraft/server-admin",
        "@minecraft/server-editor",
        "@minecraft/server-gametest",
        "@minecraft/server-graphics",
        "@minecraft/server-net",
        "@minecraft/server-ui",
    ],
});
