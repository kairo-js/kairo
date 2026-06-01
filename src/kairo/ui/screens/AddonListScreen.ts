import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { SemVerUtils } from "@kairo-js/utils";
import type { KairoWorldState } from "../../activation/types/world";
import { AddonState } from "../../activation/types/state";
import { T } from "../constants/TranslateKeys";

type GroupState = "active" | "inactive" | "unresolved";

type AddonGroup = {
    readonly addonId: string;
    readonly state: GroupState;
    readonly activeVersion?: string;
};

const STATE_PRIORITY: Record<GroupState, number> = {
    active:     0,
    inactive:   1,
    unresolved: 2,
};

const STATE_COLOR: Record<GroupState, string> = {
    active:     "§9",
    inactive:   "§c",
    unresolved: "§8",
};

const STATE_KEY: Record<GroupState, string> = {
    active:     T.addonState.active,
    inactive:   T.addonState.inactive,
    unresolved: T.addonState.unresolved,
};

export class AddonListScreen {
    async show(
        player: Player,
        world: KairoWorldState,
    ): Promise<string | null> {
        const groups = this.buildAndSortGroups(world);

        const form = new ActionFormData()
            .title({ translate: T.addonList.title });

        for (const group of groups) {
            const anyKairoId = world.addonIdIndex.get(group.addonId)!.values().next().value!;
            const registry = world.registries.get(anyKairoId)!;
            const color = STATE_COLOR[group.state];
            const stateKey = STATE_KEY[group.state];
            const iconPath = `textures/${group.addonId}/pack_icon`;

            const stateRawtext = group.activeVersion
                ? [
                    { text: `\n§l${color}` },
                    { translate: stateKey },
                    { text: `§r: ${group.activeVersion}` },
                ]
                : [
                    { text: `\n§l${color}` },
                    { translate: stateKey },
                ];

            form.button(
                {
                    rawtext: [
                        { text: "§l" },
                        { translate: registry.name },
                        ...stateRawtext,
                    ],
                },
                iconPath,
            );
        }

        const response = await form.show(player);
        if (response.canceled || response.selection === undefined) return null;

        return groups[response.selection]?.addonId ?? null;
    }

    private buildAndSortGroups(world: KairoWorldState): AddonGroup[] {
        const groups: AddonGroup[] = [];

        for (const [addonId, kairoIds] of world.addonIdIndex) {
            let hasActive = false;
            let hasInactive = false;
            let activeVersion: string | undefined;

            for (const id of kairoIds) {
                const rt = world.runtimes.get(id);
                if (rt?.state === AddonState.ACTIVE) {
                    hasActive = true;
                    activeVersion = SemVerUtils.format(world.registries.get(id)!.version);
                    break;
                }
                if (rt?.state === AddonState.INACTIVE) hasInactive = true;
            }

            const state: GroupState = hasActive ? "active" : hasInactive ? "inactive" : "unresolved";
            groups.push({ addonId, state, activeVersion });
        }

        groups.sort((a, b) => {
            const stateDiff = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
            if (stateDiff !== 0) return stateDiff;
            return a.addonId.localeCompare(b.addonId);
        });

        return groups;
    }
}
