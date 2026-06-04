import { AddonState } from "../activation/types/state";
import type { KairoWorldState } from "../activation/types/world";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import type { HandoffPayload } from "./HandoffPayload";

export class HandoffPayloadBuilder {
    build(
        registryIndex: KairoRegistryQueryable,
        world: KairoWorldState,
        activationOrder: readonly string[],
    ): HandoffPayload {
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

        const runtimes = [...world.runtimes.entries()].map(([kairoId, rt]) => ({
            kairoId,
            state: rt.state === AddonState.ACTIVE ? "ACTIVE" as const
                 : rt.state === AddonState.INACTIVE ? "INACTIVE" as const
                 : "UNRESOLVED" as const,
            inactiveReasons: [...rt.inactiveReasons.values()].map((r) => ({
                code: r.code,
                message: r.message,
                ...(r.related ? { related: [...r.related] } : {}),
            })),
            unresolvedReasons: [...rt.unresolvedReasons.values()].map((r) => ({
                code: r.code,
                message: r.message,
                ...(r.related ? { related: [...r.related] } : {}),
            })),
        }));

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

        return {
            protocol: 1,
            registries,
            runtimes,
            previousSession,
            activationOrder: [...activationOrder],
        };
    }
}
