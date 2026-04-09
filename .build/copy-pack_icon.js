import fs from "fs";
import fse from "fs-extra";
import path from "path";
import { getSafeFolderName } from "./path-utils.js";

function replaceFileWithHardLink(srcPath, dstPath) {
    if (fs.existsSync(dstPath)) {
        fs.rmSync(dstPath, { force: true });
    }

    fse.ensureDirSync(path.dirname(dstPath));

    try {
        fs.linkSync(srcPath, dstPath);
        console.debug(`[hardlink] ${dstPath} -> ${srcPath}`);
    } catch (err) {
        const code = err?.code;
        if (code === "EXDEV" || code === "EPERM" || code === "EACCES") {
            console.warn(
                `[fallback:copy] ${dstPath}\n` + `  reason: ${code}\n` + `  src: ${srcPath}`,
            );
            fse.copyFileSync(srcPath, dstPath);
            return;
        }
        throw err;
    }
}

export function writePackIcon(rootDir, properties) {
    const srcIcon = path.join(rootDir, "pack_icon.png");

    if (!fs.existsSync(srcIcon)) {
        throw new Error("pack_icon.png not found in root directory.");
    }

    const bpDir = path.join(rootDir, "BP");
    const bpIcon = path.join(bpDir, "pack_icon.png");

    fse.ensureDirSync(bpDir);
    replaceFileWithHardLink(srcIcon, bpIcon);

    const rpDir = path.join(rootDir, "RP");
    const rpIcon = path.join(rpDir, "pack_icon.png");

    fse.ensureDirSync(rpDir);
    replaceFileWithHardLink(srcIcon, rpIcon);

    if (properties?.id) {
        const safeFolderName = getSafeFolderName(properties.id, "addon id");

        const rpTexturesIcon = path.join(rpDir, "textures", safeFolderName, "pack_icon.png");

        fse.ensureDirSync(path.dirname(rpTexturesIcon));
        replaceFileWithHardLink(srcIcon, rpTexturesIcon);
    }
}
