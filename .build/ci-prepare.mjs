import { fileURLToPath } from "url";
import path from "path";
import { writeManifests } from "./generate-manifest.js";
import { writePackIcon } from "./copy-pack_icon.js";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { properties } = await writeManifests(rootDir);
writePackIcon(rootDir, properties);
