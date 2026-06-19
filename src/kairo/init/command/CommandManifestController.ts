import type { KairoRegistryQueryable } from "../../KairoRegistryIndex";

export interface CommandDeclarationEntry {
    readonly name: string;
    readonly mandatoryParameters: ReadonlyArray<{ readonly name: string; readonly type: string }>;
    readonly optionalParameters: ReadonlyArray<{ readonly name: string; readonly type: string }>;
}

export interface CommandSyntaxConflict {
    readonly commandName: string;
    readonly registrarKairoId: string;
    readonly registrarSignature: string;
    readonly otherKairoId: string;
    readonly otherSignature: string;
}

export class CommandManifestController {
    private readonly manifests = new Map<string, CommandDeclarationEntry[]>();
    private readonly conflicts: CommandSyntaxConflict[] = [];

    handleManifest(kairoId: string, commands: CommandDeclarationEntry[]): void {        this.manifests.set(kairoId, commands);
    }

    getManifests(): ReadonlyMap<string, readonly CommandDeclarationEntry[]> {
        return this.manifests;
    }

    getConflicts(): readonly CommandSyntaxConflict[] {
        return this.conflicts;
    }

    resolveRegistrars(packExecutionOrder: readonly string[]): Map<string, string> {
        const registrars = new Map<string, string>();
        const firstEntry = new Map<string, CommandDeclarationEntry>();
        this.conflicts.length = 0;

        for (const kairoId of packExecutionOrder) {
            const cmds = this.manifests.get(kairoId) ?? [];            for (const cmd of cmds) {
                if (!registrars.has(cmd.name)) {
                    registrars.set(cmd.name, kairoId);
                    firstEntry.set(cmd.name, cmd);                    continue;
                }

                const ref = firstEntry.get(cmd.name)!;
                if (areSyntaxCompatible(ref, cmd)) continue;

                const registrarKairoId = registrars.get(cmd.name)!;
                this.conflicts.push({
                    commandName: cmd.name,
                    registrarKairoId,
                    registrarSignature: commandSignature(ref),
                    otherKairoId: kairoId,
                    otherSignature: commandSignature(cmd),
                });
                console.warn(
                    `[kairo] Command syntax conflict: ${cmd.name} ` +
                    `registrar=${registrarKairoId} signature=${commandSignature(ref)} ` +
                    `vs kairoId=${kairoId} signature=${commandSignature(cmd)}`,
                );
            }
        }

        return registrars;
    }

    computeDelegatable(
        registrarKairoId: string,
        registryIndex: KairoRegistryQueryable,
        getActiveKairoId: (addonId: string) => string | undefined,
    ): Map<string, boolean> {
        const registrarCmds = this.manifests.get(registrarKairoId) ?? [];
        const registrarRegistry = registryIndex.getAll().find(r => r.kairoId === registrarKairoId);
        const delegatable = new Map<string, boolean>();

        if (!registrarRegistry) {
            for (const cmd of registrarCmds) delegatable.set(cmd.name, false);
            return delegatable;
        }

        const activeKairoId = getActiveKairoId(registrarRegistry.addonId);        for (const cmd of registrarCmds) {
            if (!activeKairoId || activeKairoId === registrarKairoId) {
                delegatable.set(cmd.name, false);                continue;
            }

            const activeCmds = this.manifests.get(activeKairoId) ?? [];
            const activeCmd = activeCmds.find(c => c.name === cmd.name);
            const value = activeCmd ? areSyntaxCompatible(cmd, activeCmd) : false;
            delegatable.set(cmd.name, value);        }

        return delegatable;
    }

    getUnavailableMessages(
        registrarKairoId: string,
        registryIndex: KairoRegistryQueryable,
        getActiveKairoId: (addonId: string) => string | undefined,
    ): Map<string, string> {
        const registrarCmds = this.manifests.get(registrarKairoId) ?? [];
        const registrarRegistry = registryIndex.getAll().find(r => r.kairoId === registrarKairoId);
        const messages = new Map<string, string>();

        if (!registrarRegistry) {
            for (const cmd of registrarCmds) messages.set(cmd.name, `${cmd.name} is not available.`);
            return messages;
        }

        const activeKairoId = getActiveKairoId(registrarRegistry.addonId);
        for (const cmd of registrarCmds) {
            if (!activeKairoId || activeKairoId === registrarKairoId) continue;

            const activeCmds = this.manifests.get(activeKairoId) ?? [];
            const activeCmd = activeCmds.find(c => c.name === cmd.name);
            if (!activeCmd) {
                messages.set(cmd.name, `${cmd.name} is not available in the active version.`);
                continue;
            }
            if (!areSyntaxCompatible(cmd, activeCmd)) {
                messages.set(
                    cmd.name,
                    `${cmd.name} cannot be delegated because command syntax differs between installed versions.`,
                );
            }
        }

        return messages;
    }
}

function areSyntaxCompatible(a: CommandDeclarationEntry, b: CommandDeclarationEntry): boolean {
    if (a.mandatoryParameters.length !== b.mandatoryParameters.length) return false;
    for (let i = 0; i < a.mandatoryParameters.length; i++) {
        if (a.mandatoryParameters[i]!.type !== b.mandatoryParameters[i]!.type) return false;
    }
    if (a.optionalParameters.length !== b.optionalParameters.length) return false;
    for (let i = 0; i < a.optionalParameters.length; i++) {
        if (a.optionalParameters[i]!.type !== b.optionalParameters[i]!.type) return false;
    }
    return true;
}

function commandSignature(cmd: CommandDeclarationEntry): string {
    const mandatory = cmd.mandatoryParameters.map(p => `<${p.type}>`).join(" ");
    const optional = cmd.optionalParameters.map(p => `[${p.type}]`).join(" ");
    return [cmd.name, mandatory, optional].filter(Boolean).join(" ");
}
