import { safeJsonParse, toError } from "@kairo-js/utils";
import type { KairoRegistryIndex } from "../../KairoRegistryIndex";
import { type ApiManifest, type CommandDeclarationEntry, validateApiManifestMessage } from "./ApiManifestSchema";

export class ApiManifestController {
    // commandName → { signature, addonIds that have conflicting definitions }
    private readonly commandSignatures = new Map<string, { signature: string; addonIds: string[] }>();

    constructor(
        private readonly kairoRegistryIndex: KairoRegistryIndex,
        private readonly onCommandConflict?: (conflicts: CommandConflict[]) => void,
    ) {}

    processManifest(kairoId: string, manifest: ApiManifest): void {
        this.kairoRegistryIndex.setManifest(kairoId, manifest);
        if (manifest.commands && manifest.commands.length > 0) {
            this.checkCommandCompatibility(kairoId, manifest.commands);
        }
    }

    handleApiManifest(message: string): void {
        const parsed = safeJsonParse(message, () => new Error("api_manifest: JSON parse failed"));

        const valid = validateApiManifestMessage(parsed);
        if (!valid) {
            return;
        }

        const { kairoId, apis, hooks, eventSubscriptions, commands } = parsed;

        const manifest: ApiManifest = { apis, hooks, eventSubscriptions, commands };
        this.kairoRegistryIndex.setManifest(kairoId, manifest);

        if (commands && commands.length > 0) {
            this.checkCommandCompatibility(kairoId, commands);
        }
    }

    private checkCommandCompatibility(kairoId: string, commands: CommandDeclarationEntry[]): void {
        const allEntries = this.kairoRegistryIndex.getAllWithManifests();
        const addonId = allEntries.find(e => e.registry.kairoId === kairoId)?.registry.addonId ?? kairoId;

        const conflicts: CommandConflict[] = [];

        for (const cmd of commands) {
            const signature = JSON.stringify({
                mandatory: cmd.mandatoryParameters,
                optional: cmd.optionalParameters,
            });

            const existing = this.commandSignatures.get(cmd.name);
            if (!existing) {
                this.commandSignatures.set(cmd.name, { signature, addonIds: [addonId] });
                continue;
            }

            if (existing.signature !== signature) {
                conflicts.push({ commandName: cmd.name, addonId });
            } else {
                existing.addonIds.push(addonId);
            }
        }

        if (conflicts.length > 0) {
            this.onCommandConflict?.(conflicts);
        }
    }
}

export interface CommandConflict {
    readonly commandName: string;
    readonly addonId: string;
}
