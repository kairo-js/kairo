import path from "path";
import os from "os";
import fs from "fs";
import fse from "fs-extra";
import { fileURLToPath } from "url";
import { writeManifests } from "./generate-manifest.js";
import { writePackIcon } from "./copy-pack_icon.js";
import { getSafeFolderName } from "./path-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveMinecraftDevPath(addonName, type) {
    const userHome = os.homedir();
    const devRoot = path.join(userHome, "AppData", "Roaming", "Minecraft Bedrock");
    if (!fs.existsSync(devRoot)) throw new Error("Bedrock folder not found.");

    return path.join(
        devRoot,
        "Users",
        "Shared",
        "games",
        "com.mojang",
        type === "behavior" ? "development_behavior_packs" : "development_resource_packs",
        addonName,
    );
}

async function main() {
    if (process.platform !== "win32") {
        console.log("Not on Windows. Skipping deploy.");
        return;
    }

    const rootDir = path.join(__dirname, "..");

    // ★ ここで BP/scripts が存在する前提
    const { bpManifest, rpManifest, versionString, properties } = await writeManifests(rootDir);

    writePackIcon(rootDir, properties);

    const bpDisplayName = bpManifest?.header?.name;
    if (!bpDisplayName) throw new Error("BP addon name not found.");

    const bpFolderName = properties.id;
    if (!bpFolderName) throw new Error("Addon id not found in properties.");
    const safeFolderName = getSafeFolderName(bpFolderName, "addon id");

    const bpDir = path.join(rootDir, "BP");
    const dstBP = resolveMinecraftDevPath(safeFolderName, "behavior");
    fse.ensureDirSync(dstBP);
    fse.emptyDirSync(dstBP);
    fse.copySync(bpDir, dstBP, { overwrite: true });
    console.log(`[deploy] BP => ${dstBP}`);

    if (rpManifest) {
        const rpDisplayName = rpManifest.header?.name;
        if (!rpDisplayName) throw new Error("RP addon name not found.");

        const rpDir = path.join(rootDir, "RP");
        const dstRP = resolveMinecraftDevPath(safeFolderName, "resource");
        fse.ensureDirSync(dstRP);
        fse.emptyDirSync(dstRP);
        fse.copySync(rpDir, dstRP, { overwrite: true });

        console.log(`[deploy] RP => ${dstRP}`);
        console.log(`[deploy] ${bpDisplayName} (${safeFolderName}) ${versionString} deployed.`);
    } else {
        console.log(
            `[deploy] ${bpDisplayName} (${safeFolderName}) ${versionString} deployed (BP only).`,
        );
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
