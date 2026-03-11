import path from "path";
import fs from "fs";
import fse from "fs-extra";
import { getSafeFolderName } from "./path-utils.js";

export function writePackIcon(rootDir, properties) {
    const srcIcon = path.join(rootDir, "pack_icon.png");

    if (!fs.existsSync(srcIcon)) {
        throw new Error("pack_icon.png not found in root directory.");
    }

    const bpDir = path.join(rootDir, "BP");
    const bpIcon = path.join(bpDir, "pack_icon.png");

    fse.ensureDirSync(bpDir);
    fse.copyFileSync(srcIcon, bpIcon);

    const rpDir = path.join(rootDir, "RP");
    const rpIcon = path.join(rpDir, "pack_icon.png");

    fse.ensureDirSync(rpDir);
    fse.copyFileSync(srcIcon, rpIcon);

    if (properties?.id) {
        const safeFolderName = getSafeFolderName(properties.id, "addon id");

        const rpTexturesIcon = path.join(rpDir, "textures", safeFolderName, "pack_icon.png");

        fse.ensureDirSync(path.dirname(rpTexturesIcon));
        fse.copyFileSync(srcIcon, rpTexturesIcon);
    }
}
