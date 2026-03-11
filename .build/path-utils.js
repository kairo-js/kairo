export function sanitizeFolderName(name) {
    if (!name) return name;
    const normalized = name.normalize("NFKC").trim();
    const sanitized = normalized
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_");

    if (!sanitized || sanitized === "." || sanitized === "..") {
        throw new Error(`Folder name "${name}" is not valid after sanitizing.`);
    }

    return sanitized;
}

export function getSafeFolderName(name, label) {
    const safeName = sanitizeFolderName(name);
    const wasSanitized = safeName !== name;
    if (wasSanitized) {
        const displayLabel = label ? ` (${label})` : "";
        console.warn(
            `[deploy] Folder name${displayLabel} contained unsupported characters; using "${safeName}".`,
        );
    }
    return safeName;
}
