import { KairoRouter, router } from "@kairo-js/router";
import { SeedRandom, SemVerUtils } from "@kairo-js/utils";
import type { AddonProperties } from "@kairo-js/properties";
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { AddonState } from "./activation/types/state";
import { KairoRuntime } from "../minecraft/KairoRuntime";
import { ActivationController } from "./activation/ActivationController";
import { KairoError, KairoErrorReason } from "./errors/KairoError";
import { KairoInitializer } from "./init/KairoInitializer";
import { KairoRegistryIndex } from "./KairoRegistryIndex";
import { KairoUI } from "./ui/KairoUI";

class Kairo {
    private runtime?: KairoRuntime;
    private readonly registryIndex = new KairoRegistryIndex();
    private activationController?: ActivationController;
    private ui?: KairoUI;

    constructor(public readonly router: KairoRouter) {}

    init(properties: AddonProperties): void {
        this.router.init(properties);
        this.runtime = new KairoRuntime();

        const initializer = new KairoInitializer(
            this.runtime,
            new SeedRandom(),
            this.registryIndex,
            this.onInitComplete,
            () => {},
        );
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });

        this.router.beforeEvents.startup.subscribe(ev => {
            ev.customCommandRegistry.registerEnum("kairo:addons_subcommand", ["list", "open", "enable", "disable", "status"]);
            ev.customCommandRegistry.registerCommand(
                {
                    name: "kairo:addons",
                    description: "Manages Kairo addons",
                    cheatsRequired: false,
                    permissionLevel: CommandPermissionLevel.GameDirectors,
                    mandatoryParameters: [
                        { name: "kairo:addons_subcommand", type: CustomCommandParamType.Enum },
                    ],
                    optionalParameters: [
                        { name: "addonId", type: CustomCommandParamType.String },
                        { name: "version", type: CustomCommandParamType.String },
                    ],
                },
                (origin, subcommand, addonId?, version?) => {
                    const player = origin.sourceEntity as Player;
                    if (subcommand === "list") {
                        system.run(() => { this.commandList(player); });
                    } else if (subcommand === "open") {
                        system.run(() => { this.ui?.open(player); });
                    } else if (subcommand === "enable" && addonId && version) {
                        system.run(() => { void this.commandEnable(addonId as string, version as string); });
                    } else if (subcommand === "disable" && addonId) {
                        if (addonId === "kairo") {
                            return { status: CustomCommandStatus.Failure, message: "Kairo cannot be disabled. Use 'enable' to switch versions." };
                        }
                        system.run(() => { void this.commandDisable(addonId as string); });
                    } else if (subcommand === "status" && addonId) {
                        system.run(() => { this.commandStatus(player, addonId as string); });
                    }
                    return { status: CustomCommandStatus.Success };
                },
            );
        });
    }

    openUI(player: Player): void {
        this.ui?.open(player);
    }

    private commandList(player: Player): void {
        if (!this.activationController) return;
        const world = this.activationController.world;

        type GroupState = "active" | "inactive" | "unresolved";
        const STATE_PRIORITY: Record<GroupState, number> = { active: 0, inactive: 1, unresolved: 2 };

        const groups: { addonId: string; state: GroupState; name: string; activeVersion?: string }[] = [];
        for (const [addonId, kairoIds] of world.addonIdIndex) {
            let hasActive = false;
            let hasInactive = false;
            let activeVersion: string | undefined;
            let name = addonId;

            for (const id of kairoIds) {
                const rt = world.runtimes.get(id);
                const reg = world.registries.get(id);
                if (reg) name = reg.name;
                if (rt?.state === AddonState.ACTIVE) {
                    hasActive = true;
                    activeVersion = SemVerUtils.format(reg!.version);
                    break;
                }
                if (rt?.state === AddonState.INACTIVE) hasInactive = true;
            }

            const state: GroupState = hasActive ? "active" : hasInactive ? "inactive" : "unresolved";
            groups.push({ addonId, state, name, activeVersion });
        }

        groups.sort((a, b) => {
            const stateDiff = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
            if (stateDiff !== 0) return stateDiff;
            return a.addonId.localeCompare(b.addonId);
        });

        const lines = groups.map(g => {
            if (g.state === "active")     return `  §a${g.name} §7${g.activeVersion}`;
            if (g.state === "unresolved") return `  §c${g.name} §7(unresolved)`;
            return `  §e${g.name} §7(inactive)`;
        });

        const header = `§b[Kairo] §fAddons (${groups.length}):`;
        player.sendMessage(lines.length > 0 ? `${header}\n${lines.join("\n")}` : header);
    }

    private commandStatus(player: Player, addonId: string): void {
        if (!this.activationController) return;
        const world = this.activationController.world;

        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds || kairoIds.size === 0) {
            player.sendMessage(`§c[Kairo] Addon "${addonId}" not found.`);
            return;
        }

        const lines: string[] = [`§b[Kairo] §f${addonId}`];
        for (const id of kairoIds) {
            const reg = world.registries.get(id);
            const rt = world.runtimes.get(id);
            if (!reg || !rt) continue;
            const ver = SemVerUtils.format(reg.version);
            if (rt.state === AddonState.ACTIVE) {
                lines.push(`  §a${ver} — ACTIVE`);
            } else if (rt.state === AddonState.INACTIVE) {
                const reasons = [...rt.inactiveReasons.keys()].join(", ");
                lines.push(`  §e${ver} — INACTIVE${reasons ? ` §7(${reasons})` : ""}`);
            } else {
                const reasons = [...rt.unresolvedReasons.keys()].join(", ");
                lines.push(`  §c${ver} — UNRESOLVED${reasons ? ` §7(${reasons})` : ""}`);
            }
        }
        player.sendMessage(lines.join("\n"));
    }

    private async commandEnable(addonId: string, versionStr: string): Promise<void> {
        if (!this.activationController) return;
        const world = this.activationController.world;

        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds) return;

        const newKairoId = [...kairoIds].find(id => {
            const reg = world.registries.get(id);
            return reg ? SemVerUtils.format(reg.version) === versionStr : false;
        });
        if (!newKairoId) return;

        const currentActiveId = [...kairoIds].find(id => world.runtimes.get(id)?.state === AddonState.ACTIVE);
        if (currentActiveId === newKairoId) return;

        if (currentActiveId) {
            await this.activationController.executeVersionSwitch(currentActiveId, newKairoId);
        } else {
            await this.activationController.executeEnable(newKairoId, "explicit");
        }
    }

    private async commandDisable(addonId: string): Promise<void> {
        if (!this.activationController) return;
        const world = this.activationController.world;

        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds) return;

        const activeId = [...kairoIds].find(id => world.runtimes.get(id)?.state === AddonState.ACTIVE);
        if (!activeId) return;

        await this.activationController.executeDisable(activeId);
    }

    private readonly onInitComplete = () => {
        (async (): Promise<void> => {
            if (!this.runtime) {
                throw new KairoError(KairoErrorReason.RuntimeNotInitialized);
            }

            this.activationController = new ActivationController(this.runtime, this.registryIndex);
            this.activationController.setup();

            const plan = this.activationController.startupResolve();
            await this.activationController.startupActivate(plan);

            this.ui = new KairoUI(this.activationController);
        })();
    };
}

export const kairo = new Kairo(router);
