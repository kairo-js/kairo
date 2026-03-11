import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pathToFileURL } from "url";

const UUID_STORE_FILE = ".uuid.json";
const VERSION_STORE_FILE = ".manifest-version.json";

const DEFAULT_BP_DEPENDENCIES = {
    "@minecraft/server": "2.4.0",
    "@minecraft/server-ui": "2.0.0",
};

const uuidStorePath = (rootDir) => path.join(rootDir, "src", UUID_STORE_FILE);
const versionStorePath = (rootDir) => path.join(rootDir, "src", VERSION_STORE_FILE);

function toVersionString(v) {
    return `${v.major}.${v.minor}.${v.patch}`;
}

function toManifestTriple(v) {
    return [v.major, v.minor, v.patch];
}

function compareVersion(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
}

function incrementPatch(v) {
    return { ...v, patch: v.patch + 1 };
}

function loadStoredVersion(rootDir) {
    const p = versionStorePath(rootDir);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")).version;
}

function saveStoredVersion(rootDir, version) {
    const p = versionStorePath(rootDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version }, null, 2), "utf-8");
}

function loadOrCreateUUIDStore(rootDir) {
    const p = uuidStorePath(rootDir);

    let raw = null;
    if (fs.existsSync(p)) {
        raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    }

    const store = {
        bp: {
            header: raw?.bp?.header ?? randomUUID(),
            module: {
                data: raw?.bp?.module?.data ?? randomUUID(),
                script: raw?.bp?.module?.script ?? randomUUID(),
            },
        },
        rp: {
            header: raw?.rp?.header ?? randomUUID(),
            modules: {
                resources: raw?.rp?.modules?.resources ?? raw?.rp?.module ?? randomUUID(),
            },
        },
    };

    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
    return store;
}

function resolveInstalledKairoVersion(rootDir) {
    const installedPkgPath = path.join(
        rootDir,
        "node_modules",
        "@kairo-js",
        "router",
        "package.json",
    );

    if (fs.existsSync(installedPkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(installedPkgPath, "utf-8"));
        if (pkg.version) {
            return pkg.version;
        }
    }

    return "0.0.0";
}

function buildCommon(header, metadata, version, kairoVersion) {
    const baseMetadata = metadata ?? {};

    const generatedWith = {
        ...(baseMetadata.generated_with ?? {}),
        kairo: [kairoVersion],
    };

    return {
        metadata: {
            ...baseMetadata,
            generated_with: generatedWith,
        },
        header: {
            name: header.name,
            description: header.description,
            version: toVersionString(version),
            min_engine_version: header.min_engine_version,
        },
    };
}

function buildBPDependencies(propDeps = [], rpHeaderUUID, version) {
    const result = Array.isArray(propDeps) ? [...propDeps] : [];

    const hasServer = result.some((d) => d.module_name === "@minecraft/server");
    const hasServerUI = result.some((d) => d.module_name === "@minecraft/server-ui");

    if (!hasServer) {
        result.push({
            module_name: "@minecraft/server",
            version: DEFAULT_BP_DEPENDENCIES["@minecraft/server"],
        });
    }

    if (!hasServerUI) {
        result.push({
            module_name: "@minecraft/server-ui",
            version: DEFAULT_BP_DEPENDENCIES["@minecraft/server-ui"],
        });
    }

    result.push({
        uuid: rpHeaderUUID,
        version: toManifestTriple(version),
    });

    return result;
}

function buildBP(common, uuids, version, propDependencies) {
    return {
        format_version: 2,
        ...common,
        header: {
            ...common.header,
            uuid: uuids.bp.header,
        },
        modules: [
            {
                type: "data",
                uuid: uuids.bp.module.data,
                version: toManifestTriple(version),
            },
            {
                type: "script",
                language: "javascript",
                entry: "scripts/index.js",
                uuid: uuids.bp.module.script,
                version: toManifestTriple(version),
            },
        ],
        dependencies: buildBPDependencies(propDependencies, uuids.rp.header, version),
        capabilities: ["script_eval"],
    };
}

function buildRP(common, uuids, version) {
    return {
        format_version: 2,
        ...common,
        header: {
            ...common.header,
            uuid: uuids.rp.header,
        },
        modules: [
            {
                type: "resources",
                uuid: uuids.rp.modules.resources,
                version: toManifestTriple(version),
            },
        ],
        dependencies: [
            {
                uuid: uuids.bp.header,
                version: toManifestTriple(version),
            },
        ],
    };
}

export async function writeManifests(rootDir) {
    const propertiesPath = path.join(rootDir, "BP", "scripts", "properties.js");
    const { properties } = await import(pathToFileURL(propertiesPath).href);

    const declaredVersion = properties.header.version;
    const storedVersion = loadStoredVersion(rootDir);

    const finalVersion =
        storedVersion && compareVersion(storedVersion, declaredVersion) >= 0
            ? incrementPatch(storedVersion)
            : declaredVersion;

    const uuids = loadOrCreateUUIDStore(rootDir);

    const kairoVersion = resolveInstalledKairoVersion(rootDir);
    const common = buildCommon(properties.header, properties.metadata, finalVersion, kairoVersion);

    const bpManifest = buildBP(common, uuids, finalVersion, properties.dependencies);
    const rpManifest = buildRP(common, uuids, finalVersion);

    fs.mkdirSync(path.join(rootDir, "BP"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "RP"), { recursive: true });

    fs.writeFileSync(
        path.join(rootDir, "BP", "manifest.json"),
        JSON.stringify(bpManifest, null, 2),
        "utf-8",
    );
    fs.writeFileSync(
        path.join(rootDir, "RP", "manifest.json"),
        JSON.stringify(rpManifest, null, 2),
        "utf-8",
    );

    saveStoredVersion(rootDir, finalVersion);

    return {
        bpManifest,
        rpManifest,
        versionString: toVersionString(finalVersion),
        properties,
    };
}
