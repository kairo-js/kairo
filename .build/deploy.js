import { spawnSync } from "child_process";
import fs from "fs";
import fse from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { writePackIcon } from "./copy-pack_icon.js";
import { writeManifests } from "./generate-manifest.js";
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

function setHiddenAttributeWindows(targetPath) {
    const result = spawnSync("attrib", ["+h", targetPath, "/l"], { stdio: "pipe" });
    if (result.status !== 0) {
        const stderr = result.stderr?.toString().trim();
        const stdout = result.stdout?.toString().trim();
        const detail = stderr || stdout || `exit code ${result.status}`;
        throw new Error(`Failed to set hidden attribute: ${detail}`);
    }
}

function replacePathWithJunction(targetPath, linkPath) {
    if (fs.existsSync(linkPath)) {
        const stat = fs.lstatSync(linkPath);
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
            fse.emptyDirSync(linkPath);
        }
        fs.rmSync(linkPath, { recursive: true, force: true });
    }

    const linkParent = path.dirname(linkPath);
    fse.ensureDirSync(linkParent);
    fs.symlinkSync(targetPath, linkPath, "junction");
    setHiddenAttributeWindows(linkPath);
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
    replacePathWithJunction(bpDir, dstBP);
    console.log(`[deploy] BP junction => ${dstBP} -> ${bpDir}`);

    if (rpManifest) {
        const rpDisplayName = rpManifest.header?.name;
        if (!rpDisplayName) throw new Error("RP addon name not found.");

        const rpDir = path.join(rootDir, "RP");
        const dstRP = resolveMinecraftDevPath(safeFolderName, "resource");
        replacePathWithJunction(rpDir, dstRP);

        console.log(`[deploy] RP junction => ${dstRP} -> ${rpDir}`);
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
