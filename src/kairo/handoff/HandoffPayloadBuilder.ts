import { AddonState, InactiveReasonCode } from "../activation/types/state";
import type { KairoWorldState } from "../activation/types/world";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type { CommandManifestController } from "../init/command/CommandManifestController";
import type { HandoffCommandManifestEntry, HandoffCommandRegistrarEntry, HandoffPayload, HandoffPendingActivation } from "./HandoffPayload";

export type HandoffSwitchTarget = {
    readonly kairoId: string;
    readonly origin: "explicit" | "latest";
};

export class HandoffPayloadBuilder {
    build(
        registryIndex: KairoRegistryQueryable,
        world: KairoWorldState,
        activationOrder: readonly string[],
        commandManifestController?: CommandManifestController,
        commandRegistrars?: ReadonlyMap<string, string>,
        switchTarget?: HandoffSwitchTarget,
        pendingActivation?: HandoffPendingActivation,
    ): HandoffPayload {
        const registryByKairoId = new Map(registryIndex.getAll().map((registry) => [registry.kairoId, registry]));
        const switchTargetRegistry = switchTarget ? registryByKairoId.get(switchTarget.kairoId) : undefined;
        const registries = registryIndex.getAllWithManifests().map(({ registry, manifest }) => ({
            kairoId: registry.kairoId,
            addonId: registry.addonId,
            version: {
                ma: registry.version.major,
                mi: registry.version.minor,
                p: registry.version.patch,
                ...(registry.version.prerelease !== undefined ? { pre: registry.version.prerelease } : {}),
            },
            name: registry.name,
            description: registry.description,
            metadata: {
                authors: [...registry.metadata.authors],
                url: registry.metadata.url,
                license: registry.metadata.license,
            },
            dependencies: { ...registry.dependencies },
            optionalDependencies: { ...registry.optionalDependencies },
            tags: [...registry.tags],
            manifest: {
                apis: manifest.apis.map((a) => ({ name: a.name })),
                hooks: manifest.hooks.map((h) => ({
                    targetAddonId: h.targetAddonId,
                    apiName: h.apiName,
                    priority: h.priority,
                    phases: [...h.phases] as string[],
                    declarationSequence: h.declarationSequence,
                    hasRollback: h.hasRollback,
                })),
                eventSubscriptions: (manifest.eventSubscriptions ?? []).map((s) => ({
                    emitterAddonId: s.emitterAddonId,
                    eventName: s.eventName,
                })),
            },
        }));

        const runtimes = [...world.runtimes.entries()].map(([kairoId, rt]) => {
            const registry = registryByKairoId.get(kairoId);
            const isSwitchingKairo = switchTarget && registry?.addonId === "kairo";
            const isSwitchTarget = switchTarget?.kairoId === kairoId;
            const dependencyBlock = switchTargetRegistry && registry
                ? findSwitchDependencyBlock(registry.dependencies, switchTargetRegistry)
                : undefined;
            const state = isSwitchTarget
                ? "ACTIVE" as const
                : isSwitchingKairo
                  ? "INACTIVE" as const
                  : dependencyBlock && rt.state === AddonState.ACTIVE
                    ? "INACTIVE" as const
                  : rt.state === AddonState.ACTIVE ? "ACTIVE" as const
                    : rt.state === AddonState.INACTIVE ? "INACTIVE" as const
                    : "UNRESOLVED" as const;

            const inactiveReasons = isSwitchTarget
                ? []
                : [
                    ...rt.inactiveReasons.values(),
                    ...(isSwitchingKairo ? [{
                        code: InactiveReasonCode.ADDON_ID_CONFLICT,
                        message: "Superseded by Kairo handoff",
                        related: [switchTarget!.kairoId],
                    }] : []),
                    ...(dependencyBlock ? [{
                        code: InactiveReasonCode.DEPENDENCY_INACTIVE,
                        message: `Dependency "${dependencyBlock.addonId}" does not satisfy "${dependencyBlock.versionRange}" after Kairo handoff`,
                        related: [switchTarget!.kairoId],
                    }] : []),
                ];

            return {
                kairoId,
                state,
                inactiveReasons: inactiveReasons.map((r) => ({
                code: r.code,
                message: r.message,
                ...(r.related ? { related: [...r.related] } : {}),
            })),
                unresolvedReasons: isSwitchingKairo
                    ? []
                    : [...rt.unresolvedReasons.values()].map((r) => ({
                code: r.code,
                message: r.message,
                ...(r.related ? { related: [...r.related] } : {}),
            })),
            };
        });

        const previousSession: Record<string, { v: { ma: number; mi: number; p: number; pre?: string }; o: "explicit" | "latest"; d?: true }> = {};
        for (const [addonId, entry] of world.previousSession) {
            previousSession[addonId] = {
                v: {
                    ma: entry.version.major,
                    mi: entry.version.minor,
                    p: entry.version.patch,
                    ...(entry.version.prerelease !== undefined ? { pre: entry.version.prerelease } : {}),
                },
                o: entry.origin,
                ...(entry.disabled ? { d: true as const } : {}),
            };
        }
        if (switchTarget) {
            const targetRegistry = registryByKairoId.get(switchTarget.kairoId);
            if (targetRegistry) {
                previousSession["kairo"] = {
                    v: {
                        ma: targetRegistry.version.major,
                        mi: targetRegistry.version.minor,
                        p: targetRegistry.version.patch,
                        ...(targetRegistry.version.prerelease !== undefined ? { pre: targetRegistry.version.prerelease } : {}),
                    },
                    o: switchTarget.origin,
                };
            }
        }

        const commandManifests: HandoffCommandManifestEntry[] = [];
        if (commandManifestController) {
            for (const [kairoId, cmds] of commandManifestController.getManifests()) {
                commandManifests.push({
                    kairoId,
                    commands: cmds.map(c => ({
                        name: c.name,
                        mandatoryParameters: [...c.mandatoryParameters],
                        optionalParameters: [...c.optionalParameters],
                    })),
                });
            }
        }

        const commandRegistrarsList: HandoffCommandRegistrarEntry[] = [];
        if (commandRegistrars) {
            for (const [name, registrarKairoId] of commandRegistrars) {
                commandRegistrarsList.push({ name, registrarKairoId });
            }
        }

        return {
            protocol: 1,
            registries,
            runtimes,
            previousSession,
            activationOrder: switchTarget
                ? [switchTarget.kairoId, ...activationOrder.filter((id) => id !== switchTarget.kairoId)]
                : [...activationOrder],
            commandManifests,
            commandRegistrars: commandRegistrarsList,
            ...(pendingActivation ? { pendingActivation } : {}),
        };
    }
}

function findSwitchDependencyBlock(
    dependencies: Readonly<Record<string, string>>,
    switchTargetRegistry: { addonId: string; version: { major: number; minor: number; patch: number; prerelease?: string } },
): { addonId: string; versionRange: string } | undefined {
    const versionRange = dependencies[switchTargetRegistry.addonId];
    if (!versionRange) return undefined;
    return versionSatisfies(switchTargetRegistry.version, versionRange)
        ? undefined
        : { addonId: switchTargetRegistry.addonId, versionRange };
}

function versionSatisfies(
    version: { major: number; minor: number; patch: number; prerelease?: string },
    range: string,
): boolean {
    const normalized = range.trim();
    if (normalized === "*" || normalized === "") return true;

    if (normalized.startsWith("^")) {
        const base = parseVersion(normalized.slice(1));
        if (!base) return false;
        if (base.major > 0) return version.major === base.major && compareVersion(version, base) >= 0;
        if (base.minor > 0) return version.major === 0 && version.minor === base.minor && compareVersion(version, base) >= 0;
        return version.major === 0 && version.minor === 0 && version.patch === base.patch && compareVersion(version, base) >= 0;
    }

    const exact = parseVersion(normalized);
    return exact ? compareVersion(version, exact) === 0 : false;
}

function parseVersion(value: string): { major: number; minor: number; patch: number; prerelease?: string } | undefined {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
    if (!match) return undefined;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        ...(match[4] !== undefined ? { prerelease: match[4] } : {}),
    };
}

function compareVersion(
    a: { major: number; minor: number; patch: number },
    b: { major: number; minor: number; patch: number },
): number {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
