import type { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { SemVerUtils } from "@kairo-js/utils";
import type { KairoRegistry } from "@kairo-js/router";
import type { KairoWorldState } from "../../activation/types/world";
import { AddonState, type KairoId } from "../../activation/types/state";
import { T } from "../constants/TranslateKeys";

export type DetailResult =
    | { readonly type: "disable" }
    | { readonly type: "activate"; readonly kairoId: KairoId; readonly origin: "latest" | "explicit" }
    | null;

type DropdownEntry =
    | { readonly kind: "inactive" }
    | { readonly kind: "disable" }
    | { readonly kind: "latest" }
    | { readonly kind: "version"; readonly kairoId: KairoId };

const STATE_COLOR = {
    [AddonState.ACTIVE]:     "§9",
    [AddonState.INACTIVE]:   "§c",
    [AddonState.UNRESOLVED]: "§8",
} as const;

const STATE_KEY = {
    [AddonState.ACTIVE]:     T.addonState.active,
    [AddonState.INACTIVE]:   T.addonState.inactive,
    [AddonState.UNRESOLVED]: T.addonState.unresolved,
} as const;

export class AddonDetailScreen {
    async show(player: Player, addonId: string, world: KairoWorldState, disableAllowed = true): Promise<DetailResult> {
        const kairoIds = [...(world.addonIdIndex.get(addonId) ?? [])];

        const activeId = kairoIds.find(id => world.runtimes.get(id)?.state === AddonState.ACTIVE);
        const selectableIds = kairoIds.filter(id => world.runtimes.get(id)?.state !== AddonState.UNRESOLVED);

        const displayId = activeId ?? this.resolveLatest(addonId, world, selectableIds) ?? kairoIds[0]!;
        const displayRegistry = world.registries.get(displayId)!;

        // State of the addonId group
        const groupState = activeId
            ? AddonState.ACTIVE
            : selectableIds.length > 0 ? AddonState.INACTIVE : AddonState.UNRESOLVED;

        // Dropdown entries
        const isActive = groupState === AddonState.ACTIVE;
        const entries: DropdownEntry[] = [
            ...(!isActive ? [{ kind: "inactive" as const }] : []),
            ...(isActive && disableAllowed ? [{ kind: "disable" as const }] : []),
            { kind: "latest" },
            ...selectableIds.map(id => ({ kind: "version" as const, kairoId: id })),
        ];

        const labels = entries.map(e => {
            if (e.kind === "inactive") return { translate: T.detail.inactive };
            if (e.kind === "disable")  return { translate: T.detail.disable };
            if (e.kind === "latest")   return { translate: T.detail.latest };
            return SemVerUtils.format(world.registries.get(e.kairoId)!.version);
        });

        const session = world.previousSession.get(addonId);
        const defaultIndex = (() => {
            if (!isActive) return entries.findIndex(e => e.kind === "inactive");
            if (session?.origin === "explicit" && activeId) {
                const idx = entries.findIndex(e => e.kind === "version" && e.kairoId === activeId);
                if (idx >= 0) return idx;
            }
            return entries.findIndex(e => e.kind === "latest");
        })();

        const versionText = activeId
            ? SemVerUtils.format(world.registries.get(activeId)!.version)
            : "-";
        const isLatestMode = !!activeId && session?.origin !== "explicit";

        // Build form — label/divider も formValues に null で入るので dropdown 位置を追跡
        let fi = 0; // formIndex
        const form = new ModalFormData().title({ translate: displayRegistry.name });

        form.label(`${displayRegistry.name}\n§7${displayRegistry.description}§r`); fi++;
        form.divider();                                                    fi++;
        form.label({
            rawtext: [
                { text: `§7id: §r${addonId}\n§7version: §r${versionText}` },
                ...(isLatestMode
                    ? [{ text: " §7(" }, { translate: T.detail.latest }, { text: ")§r" }]
                    : []
                ),
                { text: "\n§7state: §r" },
                { text: STATE_COLOR[groupState] },
                { translate: STATE_KEY[groupState] },
                ...(displayRegistry.tags.length > 0 ? [
                    { text: "\n§7tags: §r" },
                    ...displayRegistry.tags.flatMap((tag, i) => [
                        ...(i > 0 ? [{ text: ", " }] : []),
                        { translate: `kairo.tags.${tag}` },
                    ]),
                ] : []),
            ],
        });                                                                fi++;
        form.divider();                                                    fi++;

        const dropdownFormIndex = fi;
        form.dropdown({ translate: T.detail.versionLabel }, labels, { defaultValueIndex: defaultIndex });

        form.divider();
        const depsText = this.buildDepsText(displayRegistry);
        const dependentsText = this.buildDependentsText(addonId, world);
        const metadataText = this.buildMetadataText(displayRegistry);
        form.label({
            rawtext: [
                { text: "§7" },
                { translate: T.detail.developer },
                { text: `§r\n  §7id:§r ${displayId}` },
                ...(metadataText ? [{ text: "\n" + metadataText }] : []),
                ...(depsText ? [{ text: "\n\n" + depsText }] : []),
                ...(dependentsText ? [{ text: "\n\n" + dependentsText }] : []),
            ],
        });
        form.submitButton({ translate: T.detail.submitButton });

        const response = await form.show(player);
        if (response.canceled || !response.formValues) return null;

        const selectedIndex = response.formValues[dropdownFormIndex] as number;
        if (selectedIndex === defaultIndex) return null;

        const selected = entries[selectedIndex];
        if (!selected) return null;

        if (selected.kind === "inactive") return null;
        if (selected.kind === "disable") return { type: "disable" };
        if (selected.kind === "latest") {
            const latestId = this.resolveLatest(addonId, world, selectableIds);
            if (!latestId) return null;
            return { type: "activate", kairoId: latestId, origin: "latest" };
        }
        return { type: "activate", kairoId: selected.kairoId, origin: "explicit" };
    }

    private resolveLatest(addonId: string, world: KairoWorldState, selectableIds: KairoId[]): KairoId | null {
        if (selectableIds.length === 0) return null;

        const stableIds = selectableIds.filter(id => {
            const reg = world.registries.get(id);
            return reg && !SemVerUtils.isPrerelease(reg.version);
        });
        const pool = stableIds.length > 0 ? stableIds : selectableIds;

        return pool.reduce((best, cur) => {
            const a = world.registries.get(best)!;
            const b = world.registries.get(cur)!;
            return SemVerUtils.compare(b.version, a.version) > 0 ? cur : best;
        });
    }

    private buildDepsText(registry: KairoRegistry): string | null {
        const lines: string[] = [];

        const deps = Object.entries(registry.dependencies);
        if (deps.length > 0) {
            lines.push("  §7dependencies:§r");
            for (const [id, ver] of deps) lines.push(`    §7${id}§r: ${ver}`);
        }

        const opts = Object.entries(registry.optionalDependencies);
        if (opts.length > 0) {
            if (lines.length > 0) lines.push("");
            lines.push("  §7optional:§r");
            for (const [id, ver] of opts) lines.push(`    §7${id}§r: ${ver}`);
        }

        return lines.length > 0 ? lines.join("\n") : null;
    }

    private buildMetadataText(registry: KairoRegistry): string | null {
        const lines: string[] = [];
        const { authors, url, license } = registry.metadata;
        if (authors.length > 0) lines.push(`  §7authors:§r ${authors.join(", ")}`);
        if (url)     lines.push(`  §7url:§r ${url}`);
        if (license) lines.push(`  §7license:§r ${license}`);
        return lines.length > 0 ? lines.join("\n") : null;
    }

    private buildDependentsText(addonId: string, world: KairoWorldState): string | null {
        const lines: string[] = [];
        const seen = new Set<string>();

        for (const [kairoId, rt] of world.runtimes) {
            if (rt.state !== AddonState.ACTIVE) continue;
            const registry = world.registries.get(kairoId);
            if (!registry || registry.addonId === addonId) continue;
            if (seen.has(registry.addonId)) continue;

            const isRequired = addonId in registry.dependencies;
            const isOptional = addonId in registry.optionalDependencies;
            if (!isRequired && !isOptional) continue;

            seen.add(registry.addonId);
            const suffix = isOptional && !isRequired ? " §7(optional)§r" : "";
            lines.push(`    §7${registry.name}§r${suffix}`);
        }

        if (lines.length === 0) return null;
        return "  §7dependents:§r\n" + lines.join("\n");
    }
}
