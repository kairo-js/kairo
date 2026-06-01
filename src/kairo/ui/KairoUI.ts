import type { Player } from "@minecraft/server";
import { SemVerUtils } from "@kairo-js/utils";
import type { ActivationController } from "../activation/ActivationController";
import { AddonState } from "../activation/types/state";
import { AddonListScreen } from "./screens/AddonListScreen";
import { AddonDetailScreen } from "./screens/AddonDetailScreen";
import { AddonUnresolvedScreen } from "./screens/AddonUnresolvedScreen";
import { ConfirmScreen } from "./screens/ConfirmScreen";
import { T } from "./constants/TranslateKeys";

export class KairoUI {
    private readonly addonList = new AddonListScreen();
    private readonly addonDetail = new AddonDetailScreen();
    private readonly addonUnresolved = new AddonUnresolvedScreen();
    private readonly confirm = new ConfirmScreen();

    constructor(private readonly controller: ActivationController) {}

    async open(player: Player): Promise<void> {
        const world = this.controller.world;

        const selectedAddonId = await this.addonList.show(player, world);
        if (!selectedAddonId) return;

        // Check if all versions are UNRESOLVED
        const kairoIds = [...(world.addonIdIndex.get(selectedAddonId) ?? [])];
        const allUnresolved = kairoIds.every(id => world.runtimes.get(id)?.state === AddonState.UNRESOLVED);

        if (allUnresolved) {
            await this.addonUnresolved.show(player, selectedAddonId, world);
            return;
        }

        // kairo 自身は無効化不可（バージョン切替のみ）
        const disableAllowed = selectedAddonId !== "kairo";
        const result = await this.addonDetail.show(player, selectedAddonId, world, disableAllowed);
        if (!result) return;

        if (result.type === "disable") {
            await this.handleDisable(player, selectedAddonId);
        } else {
            await this.handleActivate(player, result.kairoId, result.origin, selectedAddonId);
        }
    }

    private async handleDisable(player: Player, addonId: string): Promise<void> {
        const world = this.controller.world;
        const activeId = [...(world.addonIdIndex.get(addonId) ?? [])]
            .find(id => world.runtimes.get(id)?.state === AddonState.ACTIVE);

        if (!activeId) return;

        const { cascadeVictims } = this.controller.previewDisable(activeId);

        if (cascadeVictims.length > 0) {
            const names = cascadeVictims.map(id => {
                const reg = world.registries.get(id);
                return reg ? reg.name : id;
            });
            const confirmed = await this.confirm.show(player, T.confirm.disableCascade, names);
            if (!confirmed) return;
        }

        await this.controller.executeDisable(activeId);
    }

    private async handleActivate(
        player: Player,
        newKairoId: string,
        origin: "latest" | "explicit",
        addonId: string,
    ): Promise<void> {
        const world = this.controller.world;
        const currentActiveId = [...(world.addonIdIndex.get(addonId) ?? [])]
            .find(id => world.runtimes.get(id)?.state === AddonState.ACTIVE);

        // Version switch
        if (currentActiveId && currentActiveId !== newKairoId) {
            const { cascadeVictims } = this.controller.previewVersionSwitch(newKairoId);

            if (cascadeVictims.length > 0) {
                const names = cascadeVictims.map(id => {
                    const reg = world.registries.get(id);
                    return reg ? reg.name : id;
                });
                const newReg = world.registries.get(newKairoId)!;
                const confirmed = await this.confirm.show(
                    player,
                    T.confirm.versionSwitchCascade,
                    [SemVerUtils.format(newReg.version), ...names],
                );
                if (!confirmed) return;
            }

            await this.controller.executeVersionSwitch(currentActiveId, newKairoId);
            return;
        }

        // Fresh enable
        const { plan, toActivate, implicitVersionSwitches } = this.controller.previewEnable(newKairoId);
        const depsToActivate = toActivate.filter(id => id !== newKairoId);

        if (implicitVersionSwitches.length > 0) {
            const names = implicitVersionSwitches.map(({ from, to }) => {
                const fromReg = world.registries.get(from);
                const toReg = world.registries.get(to);
                const name = toReg?.name ?? to;
                const fromVer = fromReg ? SemVerUtils.format(fromReg.version) : from;
                const toVer = toReg ? SemVerUtils.format(toReg.version) : to;
                return `${name}  ${fromVer} > ${toVer}`;
            });
            const confirmed = await this.confirm.show(player, T.confirm.enableVersionSwitch, names);
            if (!confirmed) return;
        } else if (depsToActivate.length > 0) {
            const names = depsToActivate.map(id => {
                const reg = world.registries.get(id);
                return reg ? reg.name : id;
            });
            const confirmed = await this.confirm.show(player, T.confirm.enableDeps, names);
            if (!confirmed) return;
        }

        await this.controller.executeEnableWithPlan(newKairoId, origin, plan, implicitVersionSwitches);
    }
}
