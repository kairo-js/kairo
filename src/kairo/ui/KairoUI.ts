import { InputPermissionCategory, type Player } from "@minecraft/server";
import { SemVerUtils } from "@kairo-js/utils";
import type { ActivationController } from "../activation/ActivationController";
import { AddonState } from "../activation/types/state";
import type { KairoWorldState } from "../activation/types/world";
import { AddonListScreen } from "./screens/AddonListScreen";
import { AddonDetailScreen } from "./screens/AddonDetailScreen";
import { AddonUnresolvedScreen } from "./screens/AddonUnresolvedScreen";
import { ConfirmScreen } from "./screens/ConfirmScreen";
import { T } from "./constants/TranslateKeys";

const PROTECTED_ADDONS = new Set(["kairo", "kairo-database"]);

export class KairoUI {
    private readonly addonList = new AddonListScreen();
    private readonly addonDetail = new AddonDetailScreen();
    private readonly addonUnresolved = new AddonUnresolvedScreen();
    private readonly confirm = new ConfirmScreen();

    constructor(
        private readonly controller: ActivationController,
        private readonly onKairoLiveSwitch?: (targetKairoId: string, player: Player) => boolean,
    ) {}

    async open(player: Player): Promise<void> {
        const world: KairoWorldState = this.controller.world;

        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
        try {
        while (true) {
            const selectedAddonId = await this.addonList.show(player, world);
            if (!selectedAddonId) return;

            const kairoIds = [...(world.addonIdIndex.get(selectedAddonId) ?? [])];
            const allUnresolved = kairoIds.every(
                (id) => world.runtimes.get(id)?.state === AddonState.UNRESOLVED,
            );

            if (allUnresolved) {
                await this.addonUnresolved.show(player, selectedAddonId, world);
                continue;
            }

            const disableAllowed = !PROTECTED_ADDONS.has(selectedAddonId);

            while (true) {
                const result = await this.addonDetail.show(player, selectedAddonId, world, disableAllowed);
                if (!result) break;

                const outcome =
                    result.type === "disable"
                        ? await this.handleDisable(player, selectedAddonId)
                        : selectedAddonId === "kairo"
                          ? this.handleKairoVersionSwitch(player, result.kairoId, result.origin)
                          : await this.handleActivate(player, result.kairoId, result.origin, selectedAddonId);

                if (outcome === "done") break;
                // "back" → show detail again
            }
        }
        } finally {
            player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, true);
        }
    }

    private handleKairoVersionSwitch(
        player: Player,
        kairoId: string,
        origin: "latest" | "explicit",
    ): "done" | "back" {
        const world = this.controller.world;
        const reg = world.registries.get(kairoId);
        if (!reg) return "back";

        const currentActiveId = [...(world.addonIdIndex.get("kairo") ?? [])].find(
            (id) => world.runtimes.get(id)?.state === AddonState.ACTIVE,
        );
        if (currentActiveId === kairoId) return "done";

        // Try live switch via handoff
        if (this.onKairoLiveSwitch?.(kairoId, player)) {
            return "done";
        }

        // Fallback: save preference for next reload
        this.controller.saveKairoVersionPreference(kairoId, origin);
        const ver = SemVerUtils.format(reg.version);
        const verLabel = origin === "latest" ? `Latest version (${ver})` : ver;
        player.sendMessage(`§e[Kairo] §rKairo §a${verLabel}§r is not available for live switch. Will activate on next world reload.`);
        player.playSound("random.orb");
        return "done";
    }

    private async handleDisable(player: Player, addonId: string): Promise<"done" | "back"> {
        const world = this.controller.world;
        const activeId = [...(world.addonIdIndex.get(addonId) ?? [])].find(
            (id) => world.runtimes.get(id)?.state === AddonState.ACTIVE,
        );

        if (!activeId) return "back";

        const { cascadeVictims } = this.controller.previewDisable(activeId);

        if (cascadeVictims.length > 0) {
            const names = cascadeVictims.map((id) => world.registries.get(id)?.name ?? id);
            const confirmed = await this.confirm.show(player, T.confirm.disableCascade, names);
            if (!confirmed) return "back";
        }

        await this.controller.executeDisable(activeId);

        player.sendMessage(`§b[Kairo] §r${world.registries.get(activeId)?.name ?? addonId} disabled`);
        player.playSound("random.orb");
        return "done";
    }

    private async handleActivate(
        player: Player,
        newKairoId: string,
        origin: "latest" | "explicit",
        addonId: string,
    ): Promise<"done" | "back"> {
        const world = this.controller.world;
        const currentActiveId = [...(world.addonIdIndex.get(addonId) ?? [])].find(
            (id) => world.runtimes.get(id)?.state === AddonState.ACTIVE,
        );

        const formatVer = (kairoId: string): string => {
            const reg = world.registries.get(kairoId);
            return reg ? SemVerUtils.format(reg.version) : kairoId;
        };
        const verLabel = (kairoId: string): string => {
            const ver = formatVer(kairoId);
            return origin === "latest" ? `Latest version (${ver})` : ver;
        };

        // Version switch
        if (currentActiveId && currentActiveId !== newKairoId) {
            const { cascadeVictims } = this.controller.previewVersionSwitch(newKairoId);

            if (cascadeVictims.length > 0) {
                const names = cascadeVictims.map((id) => world.registries.get(id)?.name ?? id);
                const confirmed = await this.confirm.show(player, T.confirm.versionSwitchCascade, [
                    formatVer(newKairoId),
                    ...names,
                ]);
                if (!confirmed) return "back";
            }

            await this.controller.executeVersionSwitch(currentActiveId, newKairoId);

            const name = world.registries.get(newKairoId)?.name ?? addonId;
            player.sendMessage(`§b[Kairo] §r${name} switched to §a${verLabel(newKairoId)}`);
            player.playSound("random.orb");
            return "done";
        }

        // Fresh enable
        const { plan, toActivate, implicitVersionSwitches } = this.controller.previewEnable(newKairoId);
        const depsToActivate = toActivate.filter((id) => id !== newKairoId);

        if (implicitVersionSwitches.length > 0) {
            const names = implicitVersionSwitches.map(({ from, to }) => {
                const name = world.registries.get(to)?.name ?? to;
                return `${name}  ${formatVer(from)} > ${formatVer(to)}`;
            });
            const confirmed = await this.confirm.show(player, T.confirm.enableVersionSwitch, names);
            if (!confirmed) return "back";
        } else if (depsToActivate.length > 0) {
            const names = depsToActivate.map((id) => world.registries.get(id)?.name ?? id);
            const confirmed = await this.confirm.show(player, T.confirm.enableDeps, names);
            if (!confirmed) return "back";
        }

        await this.controller.executeEnableWithPlan(newKairoId, origin, plan, implicitVersionSwitches);

        const name = world.registries.get(newKairoId)?.name ?? addonId;
        player.sendMessage(`§b[Kairo] §r${name} §a${verLabel(newKairoId)}§r enabled`);
        player.playSound("random.orb");
        return "done";
    }
}
