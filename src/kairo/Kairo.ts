import { type Disposable, type KairoCommandOrigin, KairoRouter, router } from "@kairo-js/router";
import { buildSessionPayload, parseSession, saveSession } from "./session/SessionStorage";
import { SeedRandom, SemVerUtils } from "@kairo-js/utils";
import type { AddonProperties } from "@kairo-js/properties";
import {
    CommandPermissionLevel,
    CustomCommandParamType,
    CustomCommandSource,
    CustomCommandStatus,
    system,
    world,
} from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { AddonState, InactiveReasonCode } from "./activation/types/state";
import { KairoRuntime } from "../minecraft/KairoRuntime";
import { ActivationController } from "./activation/ActivationController";
import { KairoError, KairoErrorReason } from "./errors/KairoError";
import { KairoInitializer } from "./init/KairoInitializer";
import { KairoRegistryIndex } from "./KairoRegistryIndex";
import { KairoUI } from "./ui/KairoUI";
import { KairoApiHookRegistry, type KairoHookOptions } from "./api/KairoApiHookRegistry";
import { KairoApiPipeline } from "./api/KairoApiPipeline";
import { EventPipeline } from "./event/EventPipeline";
import { HandoffEventId } from "./handoff/HandoffEventId";
import type { HandoffPayload } from "./handoff/HandoffPayload";
import type { HandoffPendingActivation } from "./handoff/HandoffPayload";
import { HandoffOrchestrator } from "./handoff/HandoffOrchestrator";
import { HandoffReceiver } from "./handoff/HandoffReceiver";
import { StandbyRegistry } from "./handoff/StandbyRegistry";
import { ApiManifestController } from "./init/api/ApiManifestController";
import { CommandManifestController, type CommandDeclarationEntry } from "./init/command/CommandManifestController";
import { KairoInitEventId } from "./init/constants/KairoInitEventId";
import { COMMAND_INVOKE_EVENT, COMMAND_ROUTED_EVENT } from "@kairo-js/router";
import { ModalFormData } from "@minecraft/server-ui";

// Set to false in test/standby packs so they don't conflict with the primary pack's command registration
const REGISTER_COMMANDS = true;

class Kairo {
    private static readonly UI_OPEN_EVENT = "kairo:ui-open";
    private static readonly COMMAND_FORWARD_EVENT = "kairo:command-forward";

    private runtime?: KairoRuntime;
    private commandManifestController?: CommandManifestController;
    private commandRegistrars?: Map<string, string>;
    private readonly registryIndex = new KairoRegistryIndex();
    private activationController?: ActivationController;
    private ui?: KairoUI;
    private apiPipeline?: KairoApiPipeline;

    private readonly kairoHookRegistry = new KairoApiHookRegistry();
    private eventPipeline?: EventPipeline;

    private isHost = false;
    private isSwitching = false;
    private properties?: AddonProperties;
    private readonly standbyRegistry = new StandbyRegistry();
    private handoffReceiver?: HandoffReceiver;
    private standbyReadyListener?: Disposable;
    private commandInvokeListener?: Disposable;
    private commandForwardListener?: Disposable;
    private uiOpenListener?: Disposable;
    private readonly pendingStandbyMessages: string[] = [];
    private readonly notifiedCommandConflictKeys = new Set<string>();

    readonly api = {
        hook: (
            targetAddonId: string,
            apiName: string,
            options: KairoHookOptions,
        ): void => {
            this.kairoHookRegistry.hook(targetAddonId, apiName, options);
        },
    };

    constructor(public readonly router: KairoRouter) {}

    init(properties: AddonProperties): void {
        this.properties = properties;
        this.router.init(properties);
        this.runtime = new KairoRuntime();

        // Listen for standby-ready broadcasts from other kairo instances.
        // Set up early so messages sent before onInitComplete are buffered.
        this.standbyReadyListener = this.runtime.receive((id, message) => {
            if (id !== HandoffEventId.StandbyReady) return;
            if (!this.isHost) {
                this.pendingStandbyMessages.push(message);
                return;
            }
            this.handleStandbyReady(message);
        });

        const initializer = new KairoInitializer(
            this.runtime,
            new SeedRandom(),
            this.registryIndex,
            properties.header.version,
            this.onInitComplete,
            this.onElectionLost,
            () => {},
        );
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });

        const shouldRegisterCommands = REGISTER_COMMANDS;
        if (shouldRegisterCommands) this.router.beforeEvents.startup.subscribe((ev) => {
            ev.customCommandRegistry.registerEnum("kairo:addons_subcommand", [
                "list",
                "open",
                "enable",
                "disable",
                "status",
            ]);
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
                        { name: "versionOrFlag", type: CustomCommandParamType.String },
                        { name: "version", type: CustomCommandParamType.String },
                    ],
                },
                (origin: KairoCommandOrigin, subcommand: string, addonId?: string, versionOrFlag?: string, version?: string) => {                    if (subcommand === "disable" && addonId === "kairo") {
                        return {
                            status: CustomCommandStatus.Failure,
                            message: "Kairo cannot be disabled. Use 'enable' to switch versions.",
                        };
                    }
                    const player = playerFromOrigin(origin);
                    if (this.isHost) {                        system.run(() => {
                            this.dispatchCommand(subcommand, addonId, versionOrFlag, version, player);
                        });
                    } else {
                        const playerName = player?.name ?? "";
                        const senderKairoId = this.router.getKairoId() ?? "";                        system.run(() => {
                            this.runtime?.send(
                                Kairo.COMMAND_FORWARD_EVENT,
                                JSON.stringify({ sub: subcommand, aid: addonId, vof: versionOrFlag, ver: version, pn: playerName, sender: senderKairoId }),
                            );
                        });
                    }
                    return { status: CustomCommandStatus.Success };
                },
                { runWhenInactive: true },
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
        const STATE_PRIORITY: Record<GroupState, number> = {
            active: 0,
            inactive: 1,
            unresolved: 2,
        };

        const groups: {
            addonId: string;
            state: GroupState;
            name: string;
            activeVersion?: string;
        }[] = [];
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

            const state: GroupState = hasActive
                ? "active"
                : hasInactive
                  ? "inactive"
                  : "unresolved";
            groups.push({ addonId, state, name, activeVersion });
        }

        groups.sort((a, b) => {
            const stateDiff = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
            if (stateDiff !== 0) return stateDiff;
            return a.addonId.localeCompare(b.addonId);
        });

        const lines = groups.map((g) => {
            if (g.state === "active") return `  §a${g.name} §7${g.activeVersion}`;
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
                const reasons = [...rt.inactiveReasons.keys()]
                    .filter(reason => reason !== InactiveReasonCode.ADDON_ID_CONFLICT)
                    .join(", ");
                lines.push(`  §e${ver} — INACTIVE${reasons ? ` §7(${reasons})` : ""}`);
            } else {
                const reasons = [...rt.unresolvedReasons.keys()].join(", ");
                lines.push(`  §c${ver} — UNRESOLVED${reasons ? ` §7(${reasons})` : ""}`);
            }
        }
        player.sendMessage(lines.join("\n"));
    }

    private async commandEnable(addonId: string, versionStr?: string, flag?: string, player?: Player): Promise<void> {
        if (!this.activationController) return;

        if (addonId === "kairo") {
            this.commandEnableKairo(versionStr, player);
            return;
        }

        const world = this.activationController.world;
        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds) return;

        const enableFlag = parseEnableFlag(flag);

        let newKairoId: string | undefined;
        let origin: "latest" | "explicit";

        if (versionStr && !isLatestKeyword(versionStr)) {
            newKairoId = [...kairoIds].find((id) => {
                const reg = world.registries.get(id);
                return reg ? SemVerUtils.format(reg.version) === versionStr : false;
            });
            origin = "explicit";
        } else {
            const resolved = this.activationController.resolveLatestKairoId(addonId);
            newKairoId = resolved?.kairoId;
            origin = resolved?.origin ?? "latest";
        }

        if (!newKairoId) {
            if (versionStr) {
                player?.sendMessage(`§c[Kairo] §rVersion §e${versionStr}§r of §e${addonId}§c not found.`);
            } else {
                player?.sendMessage(`§c[Kairo] §rNo activatable version of §e${addonId}§c found.`);
            }
            return;
        }

        const currentActiveId = [...kairoIds].find(
            (id) => world.runtimes.get(id)?.state === AddonState.ACTIVE,
        );
        if (currentActiveId === newKairoId) return;

        // ── Version switch path ──────────────────────────────────
        if (currentActiveId) {
            if (enableFlag === "dry") {
                const { cascadeVictims } = this.activationController.previewVersionSwitch(newKairoId);
                const oldReg = world.registries.get(currentActiveId);
                const newReg = world.registries.get(newKairoId);
                const oldVer = oldReg ? SemVerUtils.format(oldReg.version) : currentActiveId;
                const newVer = newReg ? SemVerUtils.format(newReg.version) : newKairoId;
                const lines = [`§b[Kairo] §rDry run — §e${addonId}§r: would switch §a${oldVer} §7→ §a${newVer}`];
                if (cascadeVictims.length > 0) {
                    const victims = cascadeVictims.map(id => {
                        const r = world.registries.get(id);
                        return r ? `§e${r.addonId}@${SemVerUtils.format(r.version)}§r` : id;
                    });
                    lines.push(`  would deactivate: ${victims.join(", ")}`);
                }
                player?.sendMessage(lines.join("\n"));
            } else {
                const { cascadeVictims } = this.activationController.previewVersionSwitch(newKairoId);
                await this.activationController.executeVersionSwitch(currentActiveId, newKairoId);
                const reg = world.registries.get(newKairoId);
                const ver = reg ? SemVerUtils.format(reg.version) : newKairoId;
                player?.sendMessage(`§b[Kairo] §r${addonId} ${ver} enabled`);
                if (cascadeVictims.length > 0) {
                    const victims = cascadeVictims.map(id => {
                        const r = world.registries.get(id);
                        return r ? `§e${r.addonId}@${SemVerUtils.format(r.version)}§r` : id;
                    });
                    player?.sendMessage(`§7[Kairo] Deactivated by version switch: ${victims.join(", ")}`);
                }
            }
            return;
        }

        // ── Enable path ──────────────────────────────────────────
        const rt = world.runtimes.get(newKairoId);
        if (rt?.state === AddonState.UNRESOLVED) {
            const reasons = [...rt.unresolvedReasons.values()].map(r => r.message).join(", ");
            player?.sendMessage(`§c[Kairo] §rCannot enable §e${addonId}§c: ${reasons}`);
            return;
        }

        const { plan, toActivate, implicitVersionSwitches } = this.activationController.previewEnable(newKairoId);
        const extraDeps = toActivate.filter(id => id !== newKairoId);
        const needsConfirmation = extraDeps.length > 0 || implicitVersionSwitches.length > 0;

        const kairoSwitch = implicitVersionSwitches.find(({ to }) => world.registries.get(to)?.addonId === "kairo");
        if (enableFlag === "force" && kairoSwitch) {
            const target = world.registries.get(kairoSwitch.to);
            if (target) {
                this.startVersionSwitch(
                    kairoSwitch.to,
                    target.version,
                    origin,
                    player,
                    { addonId, kairoId: newKairoId, origin },
                );
                return;
            }
        }

        if (enableFlag === "dry") {
            const reg = world.registries.get(newKairoId);
            const ver = reg ? SemVerUtils.format(reg.version) : newKairoId;
            const lines = [`§b[Kairo] §rDry run — would enable §e${addonId} ${ver}§r`];
            if (toActivate.length > 0) {
                const activate = toActivate.map(id => {
                    const r = world.registries.get(id);
                    return r ? `§a${r.addonId}@${SemVerUtils.format(r.version)}§r` : id;
                });
                lines.push(`  would enable: ${activate.join(", ")}`);
            }
            if (implicitVersionSwitches.length > 0) {
                const switches = implicitVersionSwitches.map(({ from, to }) => {
                    const fr = world.registries.get(from);
                    const tr = world.registries.get(to);
                    return `§e${fr?.addonId ?? from}§r (${fr ? SemVerUtils.format(fr.version) : from}→${tr ? SemVerUtils.format(tr.version) : to})`;
                });
                lines.push(`  would switch: ${switches.join(", ")}`);
            }
            player?.sendMessage(lines.join("\n"));
            return;
        }

        if (enableFlag === "force" || !needsConfirmation) {
            await this.activationController.executeEnableWithPlan(newKairoId, origin, plan, implicitVersionSwitches);
            const reg = world.registries.get(newKairoId);
            const ver = reg ? SemVerUtils.format(reg.version) : newKairoId;
            player?.sendMessage(`§b[Kairo] §r${addonId} ${ver} enabled`);
            return;
        }

        if (enableFlag === "confirm") {
            if (!player) return;
            const reg = world.registries.get(newKairoId);
            const ver = reg ? SemVerUtils.format(reg.version) : newKairoId;
            const confirmLines = [`Enable §e${addonId} ${ver}§r?`];
            if (extraDeps.length > 0) {
                const deps = extraDeps.map(id => {
                    const r = world.registries.get(id);
                    return r ? `${r.addonId}@${SemVerUtils.format(r.version)}` : id;
                });
                confirmLines.push(`Also enables: ${deps.join(", ")}`);
            }
            if (implicitVersionSwitches.length > 0) {
                const switches = implicitVersionSwitches.map(({ from, to }) => {
                    const fr = world.registries.get(from);
                    const tr = world.registries.get(to);
                    const fv = fr ? SemVerUtils.format(fr.version) : from;
                    const tv = tr ? SemVerUtils.format(tr.version) : to;
                    return `${fr?.addonId ?? from}: ${fv} → ${tv}`;
                });
                confirmLines.push(`Version switches: ${switches.join(", ")}`);
            }
            confirmLines.push("§7Check the box and submit to confirm.");

            const form = new ModalFormData()
                .title("Kairo: Confirm Enable")
                .toggle(confirmLines.join("\n"), { defaultValue: false });
            const response = await form.show(player);
            if (response.canceled || !response.formValues?.[0]) return;

            await this.activationController.executeEnableWithPlan(newKairoId, origin, plan, implicitVersionSwitches);
            player.sendMessage(`§b[Kairo] §r${addonId} ${ver} enabled`);
            return;
        }

        // No flag, needs confirmation → error
        if (extraDeps.length > 0) {
            const deps = extraDeps.map(id => {
                const r = world.registries.get(id);
                return r ? `§e${r.addonId}§r` : id;
            }).join(", ");
            player?.sendMessage(`§c[Kairo] §rCannot enable §e${addonId}§c — inactive dependencies: ${deps}\n§7Use §f-force§7 or §f-confirm§7.`);
        } else {
            const switches = implicitVersionSwitches.map(({ from }) => {
                const r = world.registries.get(from);
                return r ? `§e${r.addonId}§r` : from;
            }).join(", ");
            player?.sendMessage(`§c[Kairo] §rEnabling §e${addonId}§c requires version switch on: ${switches}\n§7Use §f-force§7 or §f-confirm§7.`);
        }
    }

    private commandEnableKairo(versionStr?: string, player?: Player): void {
        if (!this.activationController) return;        if (this.isSwitching) {
            player?.sendMessage("§c[Kairo] §rVersion switch already in progress. Please wait.");
            return;
        }

        const ownKairoId = this.router.getKairoId();
        const currentKairoIds = this.activationController.world.addonIdIndex.get("kairo");
        const currentActiveId = currentKairoIds
            ? [...currentKairoIds].find((id) => this.activationController?.world.runtimes.get(id)?.state === AddonState.ACTIVE)
            : undefined;
        if (versionStr && currentActiveId) {
            const currentRegistry = this.activationController.world.registries.get(currentActiveId);
            if (currentRegistry && SemVerUtils.format(currentRegistry.version) === versionStr) {
                player?.sendMessage(`\u00a7b[Kairo] \u00a7rKairo ${versionStr} is already active.`);
                return;
            }
        }

        // Find the target standby entry
        let standbyEntry = versionStr
            ? this.standbyRegistry.findByVersionString(versionStr)
            : this.standbyRegistry.findBest();
        if (standbyEntry?.kairoId === ownKairoId) {
            standbyEntry = undefined;
        }

        if (standbyEntry) {            this.startVersionSwitch(standbyEntry.kairoId, standbyEntry.version, versionStr ? "explicit" : "latest", player);
        } else {            // Fallback: save preference for next reload
            const world = this.activationController.world;

            let targetKairoId: string | undefined;
            let origin: "latest" | "explicit";

            if (versionStr) {
                const kairoIds = world.addonIdIndex.get("kairo");
                targetKairoId = kairoIds ? [...kairoIds].find((id) => {
                    const reg = world.registries.get(id);
                    return reg ? SemVerUtils.format(reg.version) === versionStr : false;
                }) : undefined;
                origin = "explicit";
            } else {
                const resolved = this.activationController.resolveLatestKairoId("kairo");
                targetKairoId = resolved?.kairoId;
                origin = resolved?.origin ?? "latest";
            }

            if (!targetKairoId) {
                if (versionStr) {
                    player?.sendMessage(`§c[Kairo] §rKairo version §e${versionStr}§c not found.`);
                }
                return;
            }

            this.activationController.saveKairoVersionPreference(targetKairoId, origin);
            const reg = world.registries.get(targetKairoId);
            const ver = reg ? SemVerUtils.format(reg.version) : targetKairoId;
            player?.sendMessage(`§e[Kairo] §rKairo ${ver} is not available for live switch. Will activate on next world reload.`);
            player?.playSound("random.orb");
        }
    }

    private startVersionSwitch(
        targetKairoId: string,
        targetVersion: { major: number; minor: number; patch: number },
        origin: "explicit" | "latest" = "explicit",
        player?: Player,
        pendingActivation?: Omit<HandoffPendingActivation, "playerName">,
    ): void {
        if (!this.apiPipeline || !this.activationController) return;

        this.isSwitching = true;
        const ver = SemVerUtils.format({ ...targetVersion, prerelease: undefined });        player?.sendMessage(`§b[Kairo] §rSwitching to Kairo ${ver}...`);

        // Save the session preference via a direct ScriptEvent to kairo-database's
        // bootstrap listener. router.save() goes through the API pipeline which will
        // enter switching mode before the async kairo:api-call is processed, causing
        // the save to be silently rejected.
        const switchTargetRegistry = this.activationController.world.registries.get(targetKairoId);
        if (switchTargetRegistry && this.runtime) {
            const updatedSession = new Map(this.activationController.world.previousSession);
            updatedSession.set(switchTargetRegistry.addonId, { version: switchTargetRegistry.version, origin });
            this.runtime.send(KairoInitEventId.SessionSave, buildSessionPayload(updatedSession));
        }

        const orchestrator = new HandoffOrchestrator(
            this.runtime!,
            this.apiPipeline,
            this.registryIndex,
            this.activationController,
            () => {
                // Handoff complete — tear down host infrastructure
                this.isSwitching = false;
                this.isHost = false;
                this.apiPipeline?.dispose();
                this.apiPipeline = undefined;
                this.eventPipeline?.dispose();
                this.eventPipeline = undefined;
                this.activationController = undefined;
                this.commandManifestController = undefined;
                this.commandRegistrars = undefined;
                this.disposeHostListeners();
                this.ui = undefined;
                this.enterStandbyMode("handoff-complete");
                player?.sendMessage(`§a[Kairo] §rSwitch to Kairo ${ver} complete.`);
                player?.playSound("random.levelup");
            },
            () => {
                // Handoff failed — rolled back
                this.isSwitching = false;
                player?.sendMessage(`§c[Kairo] §rSwitch to Kairo ${ver} failed. Staying on current version.`);
            },
            this.commandManifestController,
            this.commandRegistrars,
        );

        orchestrator.start(
            targetKairoId,
            origin,
            pendingActivation
                ? {
                    ...pendingActivation,
                    ...(player?.name ? { playerName: player.name } : {}),
                }
                : undefined,
        );
    }

    private async commandDisable(addonId: string): Promise<void> {
        if (!this.activationController) return;
        const world = this.activationController.world;

        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds) return;

        const activeId = [...kairoIds].find(
            (id) => world.runtimes.get(id)?.state === AddonState.ACTIVE,
        );
        if (!activeId) return;

        await this.activationController.executeDisable(activeId);
    }

    private dispatchCommand(subcommand: string, addonId?: string, versionOrFlag?: string, version?: string, player?: Player): void {        if (subcommand === "list") {
            if (player) this.commandList(player);
        } else if (subcommand === "open") {
            if (this.ui && player) {
                void this.ui.open(player);
            }
        } else if (subcommand === "enable" && addonId) {
            const isFlag = versionOrFlag?.startsWith("-") ?? false;
            const targetFlag = isFlag ? versionOrFlag : undefined;
            const targetVersion = isFlag ? version : versionOrFlag;
            void this.commandEnable(addonId, targetVersion, targetFlag, player);
        } else if (subcommand === "disable" && addonId) {
            void this.commandDisable(addonId);
        } else if (subcommand === "status" && addonId) {
            if (player) this.commandStatus(player, addonId);
        }
    }

    private startCommandForwardListener(): void {
        const ownKairoId = this.router.getKairoId() ?? "";        this.commandForwardListener?.dispose();
        this.commandForwardListener = this.runtime?.receive((id, message) => {
            if (id !== Kairo.COMMAND_FORWARD_EVENT) return;
            try {
                const data = JSON.parse(message) as {
                    sub: string;
                    aid?: string;
                    vof?: string;
                    ver?: string;
                    pn?: string;
                    sender?: string;
                };                if (data.sender && data.sender === ownKairoId) return;
                system.run(() => {
                    const player = data.pn
                        ? world.getPlayers().find(p => p.name === data.pn)
                        : undefined;
                    this.dispatchCommand(data.sub, data.aid, data.vof, data.ver, player);
                });
            } catch {}
        });
    }

    private startUIOpenListener(): void {        this.uiOpenListener?.dispose();
        this.uiOpenListener = this.runtime?.receive((id, playerName) => {
            if (id !== Kairo.UI_OPEN_EVENT) return;            if (!this.ui) {
                console.warn(`[kairo] UI_OPEN_EVENT: ui is null, ignoring`);
                return;
            }
            system.run(() => {
                const players = world.getPlayers();
                const p = players.find(pl => pl.name === playerName);                if (p && this.ui) void this.ui.open(p);
            });
        });
    }

    private buildUI(activationController: ActivationController): KairoUI {
        return new KairoUI(
            activationController,
            (targetKairoId, origin, player, pendingActivation) => {
                const entry = this.standbyRegistry.findByKairoId(targetKairoId);
                if (!entry) return false;
                this.startVersionSwitch(targetKairoId, entry.version, origin, player, pendingActivation);
                return true;
            },
        );
    }

    pushDelegatableUpdates(): void {
        if (!this.commandManifestController || !this.commandRegistrars || !this.runtime || !this.activationController) return;

        const world = this.activationController.world;
        const getActiveKairoId = (addonId: string): string | undefined => {
            const kairoIds = world.addonIdIndex.get(addonId);
            if (!kairoIds) return undefined;
            for (const id of kairoIds) {
                if (world.runtimes.get(id)?.state === AddonState.ACTIVE) return id;
            }
            return undefined;
        };

        const registrarSet = new Set(this.commandRegistrars.values());
        for (const registrarKairoId of registrarSet) {
            const delegatable = this.commandManifestController.computeDelegatable(
                registrarKairoId,
                this.registryIndex,
                getActiveKairoId,
            );
            const unavailableMessages = this.commandManifestController.getUnavailableMessages(
                registrarKairoId,
                this.registryIndex,
                getActiveKairoId,
            );            this.runtime.send(
                KairoInitEventId.CommandDelegatableUpdate,
                JSON.stringify({
                    targetKairoId: registrarKairoId,
                    delegatable: Object.fromEntries(delegatable),
                    unavailableMessages: Object.fromEntries(unavailableMessages),
                }),
            );
        }
    }

    private notifyCommandSyntaxConflicts(): void {
        if (!this.commandManifestController || !this.activationController) return;

        const conflicts = this.commandManifestController.getConflicts();
        if (conflicts.length === 0) return;

        const registryName = (kairoId: string): string => {
            const registry = this.activationController?.world.registries.get(kairoId)
                ?? this.registryIndex.getAll().find(r => r.kairoId === kairoId);
            if (!registry) return kairoId;
            return `${registry.name}@${SemVerUtils.format(registry.version)}`;
        };

        const lines: string[] = [];
        for (const conflict of conflicts) {
            const key = `${conflict.commandName}:${conflict.registrarKairoId}:${conflict.otherKairoId}`;
            if (this.notifiedCommandConflictKeys.has(key)) continue;
            this.notifiedCommandConflictKeys.add(key);
            lines.push(
                `§c- ${conflict.commandName}§r: ` +
                `${registryName(conflict.registrarKairoId)} (${conflict.registrarSignature}) vs ` +
                `${registryName(conflict.otherKairoId)} (${conflict.otherSignature})`,
            );
        }
        if (lines.length === 0) return;

        const message = [
            "§c[Kairo] Command syntax conflicts detected.",
            "§eCommands with different argument syntax cannot be delegated across versions.",
            "§eRemove one of the conflicting addon versions, or use a new command id for the new syntax.",
            ...lines,
        ].join("\n");

        console.warn(`[kairo] Command syntax conflicts detected:\n${lines.join("\n")}`);
        for (const player of world.getPlayers()) {
            player.sendMessage(message);
        }
    }

    private startCommandInvokeListener(): void {
        if (!this.runtime) return;        this.commandInvokeListener?.dispose();
        this.commandInvokeListener = this.runtime.receive((id, message) => {
            if (id !== COMMAND_INVOKE_EVENT) return;
            try {
                const payload = JSON.parse(message) as {
                    addonId: string;
                    commandName: string;
                    origin: unknown;
                    args: unknown[];
                };                if (typeof payload.addonId !== "string") return;

                const world = this.activationController?.world;
                if (!world) return;

                const kairoIds = world.addonIdIndex.get(payload.addonId);
                if (!kairoIds) return;
                let targetKairoId: string | undefined;
                for (const id of kairoIds) {
                    if (world.runtimes.get(id)?.state === AddonState.ACTIVE) {
                        targetKairoId = id;
                        break;
                    }
                }
                if (!targetKairoId) return;                this.runtime!.send(
                    COMMAND_ROUTED_EVENT,
                    JSON.stringify({
                        targetKairoId,
                        commandName: payload.commandName,
                        origin: payload.origin,
                        args: payload.args,
                    }),
                );
            } catch {}
        });
    }

    private disposeHostListeners(): void {
        this.commandInvokeListener?.dispose();
        this.commandInvokeListener = undefined;
        this.commandForwardListener?.dispose();
        this.commandForwardListener = undefined;
        this.uiOpenListener?.dispose();
        this.uiOpenListener = undefined;
    }

    private enterStandbyMode(reason: string): void {        this.router.onceRegistered((ownKairoId) => {
            if (!this.runtime || !this.properties) return;

            const version = this.properties.header.version;
            const verStr = SemVerUtils.format(version);            this.runtime.send(
                HandoffEventId.StandbyReady,
                JSON.stringify({
                    kairoId: ownKairoId,
                    version: {
                        ma: version.major,
                        mi: version.minor,
                        p: version.patch,
                        ...(version.prerelease !== undefined ? { pre: version.prerelease } : {}),
                    },
                }),
            );

            this.handoffReceiver?.dispose();
            this.handoffReceiver = new HandoffReceiver(
                this.runtime,
                ownKairoId,
                this.onHandoffReceived,
            );
            this.handoffReceiver.setup();
        });
    }

    private readonly onElectionLost = (): void => {        this.router.onceRegistered((ownKairoId) => {
            if (!this.runtime || !this.properties) return;

            const version = this.properties.header.version;
            const verStr = SemVerUtils.format(version);            // Announce standby availability to the host
            this.runtime.send(
                HandoffEventId.StandbyReady,
                JSON.stringify({
                    kairoId: ownKairoId,
                    version: {
                        ma: version.major,
                        mi: version.minor,
                        p: version.patch,
                        ...(version.prerelease !== undefined ? { pre: version.prerelease } : {}),
                    },
                }),
            );

            // Set up handoff receiver
            this.handoffReceiver = new HandoffReceiver(
                this.runtime,
                ownKairoId,
                this.onHandoffReceived,
            );
            this.handoffReceiver.setup();
        });
    };

    private handleStandbyReady(message: string): void {
        try {
            const data = JSON.parse(message) as {
                kairoId: string;
                version: { ma: number; mi: number; p: number; pre?: string };
            };
            if (typeof data.kairoId !== "string") return;
            if (data.kairoId === this.router.getKairoId()) {                return;
            }
            const version = {
                major: data.version.ma,
                minor: data.version.mi,
                patch: data.version.p,
                ...(data.version.pre !== undefined ? { prerelease: data.version.pre } : {}),
            };
            this.standbyRegistry.record(data.kairoId, version);        } catch {}
    }

    private readonly onHandoffReceived = (payload: HandoffPayload): void => {
        if (!this.runtime) return;

        this.handoffReceiver?.dispose();
        this.handoffReceiver = undefined;

        // Rebuild registry from handoff payload
        this.registryIndex.loadFromHandoff(payload.registries);

        // Determine own kairoId
        const ownKairoId = this.router.getKairoId() ?? "kairo";

        this.kairoHookRegistry.setKairoKairoId(ownKairoId);

        // Set up activation controller (restore state without sending activation requests)
        this.activationController = new ActivationController(
            this.runtime,
            this.registryIndex,
            (kairoId) => this.apiPipeline?.notifyAddonDeactivated(kairoId),
            (session) => saveSession(session),
            () => this.pushDelegatableUpdates(),
        );
        this.activationController.setup();
        this.activationController.restoreFromHandoff(payload);
        this.normalizeKairoHostAfterHandoff(ownKairoId);

        // Set up API pipeline
        this.apiPipeline = new KairoApiPipeline(
            this.runtime,
            this.kairoHookRegistry,
            () => ownKairoId,
        );
        this.apiPipeline.initialize(this.registryIndex.getAllWithManifests(), ownKairoId);

        // Set up Event pipeline
        this.eventPipeline = new EventPipeline(this.runtime);
        this.eventPipeline.initialize(this.registryIndex.getAllWithManifests());

        const world = this.activationController.world;
        this.apiPipeline.setWorld(world);
        this.eventPipeline.setWorld(world);

        const manifestController = new ApiManifestController(this.registryIndex);
        for (const { registry, manifest } of this.registryIndex.getAllWithManifests()) {
            manifestController.processManifest(registry.kairoId, manifest);
        }

        this.ui = this.buildUI(this.activationController);
        this.startUIOpenListener();

        // Restore command routing infrastructure from handoff payload
        const cmdController = new CommandManifestController();
        for (const entry of payload.commandManifests ?? []) {
            cmdController.handleManifest(entry.kairoId, [...entry.commands] as CommandDeclarationEntry[]);
        }
        this.commandManifestController = cmdController;
        this.commandRegistrars = new Map(
            (payload.commandRegistrars ?? []).map(r => [r.name, r.registrarKairoId]),
        );
        this.startCommandInvokeListener();
        this.startCommandForwardListener();

        this.isHost = true;        this.notifyCommandSyntaxConflicts();

        // Flush any standby-ready messages received before we became host
        for (const msg of this.pendingStandbyMessages) {
            this.handleStandbyReady(msg);
        }
        this.pendingStandbyMessages.length = 0;

        // Reflect current activation state to all command registrars
        this.pushDelegatableUpdates();

        if (payload.pendingActivation) {
            system.run(() => {
                void this.resumePendingActivation(payload.pendingActivation!);
            });
        }

        // Save updated session (new kairo version is now host).
        // router.save() would fail here because the router is INACTIVE (ADDON_ID_CONFLICT
        // until registration completes), so we use a direct ScriptEvent to the bootstrap
        // listener in kairo-database which is always active.
        this.runtime.send(KairoInitEventId.SessionSave, buildSessionPayload(world.previousSession));    };

    private async resumePendingActivation(pending: HandoffPendingActivation): Promise<void> {
        if (!this.activationController) return;

        const worldState = this.activationController.world;
        const registry = worldState.registries.get(pending.kairoId);
        const player = pending.playerName
            ? world.getPlayers().find(p => p.name === pending.playerName)
            : undefined;

        if (!registry) {
            player?.sendMessage(`§c[Kairo] §rCannot resume activation for §e${pending.addonId}§c: target not found.`);
            return;
        }

        try {
            await this.activationController.executeEnable(pending.kairoId, pending.origin);

            const runtime = worldState.runtimes.get(pending.kairoId);
            if (runtime?.state !== AddonState.ACTIVE) {
                const reasons = runtime
                    ? [...runtime.inactiveReasons.keys(), ...runtime.unresolvedReasons.keys()].join(", ")
                    : "missing runtime";
                console.warn(`[kairo] pending activation did not become active addonId=${pending.addonId} kairoId=${pending.kairoId} state=${runtime?.state ?? "<missing>"} reasons=${reasons || "<none>"}`);
                player?.sendMessage(`§c[Kairo] §rFailed to enable §e${pending.addonId}§c after Kairo switch: ${reasons || "unknown reason"}.`);
                this.pushDelegatableUpdates();
                return;
            }

            this.pushDelegatableUpdates();
            player?.sendMessage(`§b[Kairo] §r${registry.name} §a${SemVerUtils.format(registry.version)}§r enabled`);
            player?.playSound("random.orb");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[kairo] pending activation failed addonId=${pending.addonId} kairoId=${pending.kairoId}: ${message}`);
            player?.sendMessage(`§c[Kairo] §rFailed to enable §e${pending.addonId}§c after Kairo switch.`);
        }
    }

    private normalizeKairoHostAfterHandoff(ownKairoId: string): void {
        if (!this.activationController) return;

        const world = this.activationController.world;
        const ownRegistry = world.registries.get(ownKairoId);
        if (!ownRegistry || ownRegistry.addonId !== "kairo") return;

        const kairoIds = world.addonIdIndex.get("kairo") ?? new Set<string>();
        for (const kairoId of kairoIds) {
            const rt = world.runtimes.get(kairoId);
            if (!rt) continue;

            if (kairoId === ownKairoId) {
                rt.state = AddonState.ACTIVE;
                rt.inactiveReasons.clear();
                rt.unresolvedReasons.clear();
                continue;
            }

            rt.state = AddonState.INACTIVE;
            rt.unresolvedReasons.clear();
            rt.inactiveReasons.set(InactiveReasonCode.ADDON_ID_CONFLICT, {
                code: InactiveReasonCode.ADDON_ID_CONFLICT,
                message: "Superseded by Kairo handoff",
                related: [ownKairoId],
            });
        }

        const existingSession = world.previousSession.get("kairo");
        world.previousSession.set("kairo", {
            version: ownRegistry.version,
            origin: existingSession?.origin ?? "explicit",
        });    }

    private syncKairoSessionAfterStartup(): void {
        if (!this.activationController) return;

        const world = this.activationController.world;
        const existingSession = world.previousSession.get("kairo");
        if (!existingSession) return;

        const activeKairoId = [...(world.addonIdIndex.get("kairo") ?? [])].find(
            (kairoId) => world.runtimes.get(kairoId)?.state === AddonState.ACTIVE,
        );
        if (!activeKairoId) return;

        const activeRegistry = world.registries.get(activeKairoId);
        if (!activeRegistry || activeRegistry.addonId !== "kairo") return;

        // If the session had an explicit preference that doesn't exactly match the winner,
        // look for an installed kairo with the same major.minor.patch (different prerelease).
        // This self-heals stale prerelease sessions (e.g. 1.1.0-beta.0 → 1.1.0 stable).
        let sessionVersion = activeRegistry.version;
        if (
            existingSession.origin === "explicit" &&
            !SemVerUtils.equals(activeRegistry.version, existingSession.version)
        ) {
            for (const kairoId of world.addonIdIndex.get("kairo") ?? []) {
                const reg = world.registries.get(kairoId);
                if (
                    reg !== undefined &&
                    reg.version.major === existingSession.version.major &&
                    reg.version.minor === existingSession.version.minor &&
                    reg.version.patch === existingSession.version.patch
                ) {
                    sessionVersion = reg.version;
                    break;
                }
            }
        }

        world.previousSession.set("kairo", {
            version: sessionVersion,
            origin: existingSession.origin,
            ...(existingSession.disabled ? { disabled: true as const } : {}),
        });
        saveSession(world.previousSession);    }

    private readonly onInitComplete = (
        sessionPayload: string | null,
        cmdController: CommandManifestController,
        cmdRegistrars: Map<string, string>,
    ) => {
        this.commandManifestController = cmdController;
        this.commandRegistrars = cmdRegistrars;

        (async (): Promise<void> => {
            if (!this.runtime) {
                throw new KairoError(KairoErrorReason.RuntimeNotInitialized);
            }

            // ── Infrastructure Boot Phase ────────────────────────
            const initialSession = parseSession(sessionPayload);

            this.activationController = new ActivationController(
                this.runtime,
                this.registryIndex,
                (kairoId) => this.apiPipeline?.notifyAddonDeactivated(kairoId),
                (session) => saveSession(session),
                () => this.pushDelegatableUpdates(),
            );
            this.activationController.setup();

            const plan = this.activationController.startupResolve(initialSession);

            // Initialize API pipeline after Registration finalized
            const routerAddonId = this.router.getAddonId();
            const ownRegistry = routerAddonId
                ? this.registryIndex.getAll().find((r) => r.addonId === routerAddonId)
                : undefined;
            const ownKairoId = ownRegistry?.kairoId ?? "kairo";

            this.kairoHookRegistry.setKairoKairoId(ownKairoId);

            this.apiPipeline = new KairoApiPipeline(
                this.runtime,
                this.kairoHookRegistry,
                () => ownKairoId,
            );

            this.apiPipeline.initialize(
                this.registryIndex.getAllWithManifests(),
                ownKairoId,
            );

            this.eventPipeline = new EventPipeline(this.runtime);
            this.eventPipeline.initialize(this.registryIndex.getAllWithManifests());

            this.apiPipeline.setWorld(this.activationController.world);
            this.eventPipeline.setWorld(this.activationController.world);

            await this.activationController.startupActivate(plan);
            this.syncKairoSessionAfterStartup();

            this.pushDelegatableUpdates();
            this.startCommandInvokeListener();
            this.startCommandForwardListener();

            this.ui = this.buildUI(this.activationController);
            this.startUIOpenListener();

            this.isHost = true;            this.notifyCommandSyntaxConflicts();

            // Flush buffered standby-ready messages received during init
            for (const msg of this.pendingStandbyMessages) {
                this.handleStandbyReady(msg);
            }
            this.pendingStandbyMessages.length = 0;
        })();
    };
}

export const kairo = new Kairo(router);

function playerFromOrigin(origin: KairoCommandOrigin): Player | undefined {
    if (origin.sourceType === CustomCommandSource.Entity) {
        const entity = origin.sourceEntity;
        return entity?.typeId === "minecraft:player" ? (entity as Player) : undefined;
    }
    if (origin.sourceType === CustomCommandSource.NPCDialogue) {
        const initiator = origin.initiator;
        return initiator?.typeId === "minecraft:player" ? (initiator as Player) : undefined;
    }
    return undefined;
}

function isLatestKeyword(v: string): boolean {
    return /^latest(\s+version)?$/i.test(v);
}

type EnableFlag = "force" | "confirm" | "dry" | undefined;

function parseEnableFlag(flag: string | undefined): EnableFlag {
    switch (flag) {
        case "-force": case "-f": return "force";
        case "-confirm": case "-c": return "confirm";
        case "-dry": return "dry";
        default: return undefined;
    }
}
