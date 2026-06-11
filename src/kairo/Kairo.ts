import { type Disposable, type KairoCommandOrigin, KairoRouter, router } from "@kairo-js/router";
import { parseSession, saveSession } from "./session/SessionStorage";
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
import { AddonState } from "./activation/types/state";
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
import { HandoffOrchestrator } from "./handoff/HandoffOrchestrator";
import { HandoffReceiver } from "./handoff/HandoffReceiver";
import { StandbyRegistry } from "./handoff/StandbyRegistry";
import { ApiManifestController } from "./init/api/ApiManifestController";

// Set to false in test/standby packs so they don't conflict with the primary pack's command registration
const REGISTER_COMMANDS = true;

class Kairo {
    private static readonly UI_OPEN_EVENT = "kairo:ui-open";

    private runtime?: KairoRuntime;
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
    private readonly pendingStandbyMessages: string[] = [];

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
            this.handleCommandConflict,
        );
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });

        if (REGISTER_COMMANDS) this.router.beforeEvents.startup.subscribe((ev) => {
            ev.commands.registerEnum("kairo:addons_subcommand", [
                "list",
                "open",
                "enable",
                "disable",
                "status",
            ]);
            ev.commands.register(
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
                (origin: KairoCommandOrigin, subcommand: string, addonId?: string, version?: string) => {
                    const player = playerFromOrigin(origin);
                    if (subcommand === "list") {
                        system.run(() => {
                            if (player) this.commandList(player);
                        });
                    } else if (subcommand === "open") {
                        const playerName = player?.name ?? "";
                        console.log(`[kairo] open cmd handler: player=${playerName} ui=${!!this.ui} isHost=${this.isHost}`);
                        system.run(() => {
                            if (this.ui && player) {
                                console.log(`[kairo] open: opening UI directly`);
                                void this.ui.open(player);
                            } else if (playerName) {
                                console.log(`[kairo] open: sending ScriptEvent ${Kairo.UI_OPEN_EVENT} to host`);
                                this.runtime?.send(Kairo.UI_OPEN_EVENT, playerName);
                            } else {
                                console.warn(`[kairo] open: no player and no playerName`);
                            }
                        });
                    } else if (subcommand === "enable" && addonId) {
                        // Support "addonId@version" syntax when the optional version param is not received
                        const at = !version ? addonId.lastIndexOf("@") : -1;
                        const targetId = at > 0 ? addonId.slice(0, at) : addonId;
                        const targetVersion = at > 0 ? addonId.slice(at + 1) : version;
                        const _player = player;
                        system.run(() => {
                            void this.commandEnable(targetId, targetVersion, _player);
                        });
                    } else if (subcommand === "disable" && addonId) {
                        if (addonId === "kairo") {
                            return {
                                status: CustomCommandStatus.Failure,
                                message:
                                    "Kairo cannot be disabled. Use 'enable' to switch versions.",
                            };
                        }
                        system.run(() => {
                            void this.commandDisable(addonId);
                        });
                    } else if (subcommand === "status" && addonId) {
                        system.run(() => {
                            if (player) this.commandStatus(player, addonId);
                        });
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
                const reasons = [...rt.inactiveReasons.keys()].join(", ");
                lines.push(`  §e${ver} — INACTIVE${reasons ? ` §7(${reasons})` : ""}`);
            } else {
                const reasons = [...rt.unresolvedReasons.keys()].join(", ");
                lines.push(`  §c${ver} — UNRESOLVED${reasons ? ` §7(${reasons})` : ""}`);
            }
        }
        player.sendMessage(lines.join("\n"));
    }

    private async commandEnable(addonId: string, versionStr?: string, player?: Player): Promise<void> {
        if (!this.activationController) return;

        if (addonId === "kairo") {
            this.commandEnableKairo(versionStr, player);
            return;
        }

        const world = this.activationController.world;

        const kairoIds = world.addonIdIndex.get(addonId);
        if (!kairoIds) return;

        let newKairoId: string | undefined;
        let origin: "latest" | "explicit";

        if (versionStr) {
            newKairoId = [...kairoIds].find((id) => {
                const reg = world.registries.get(id);
                return reg ? SemVerUtils.format(reg.version) === versionStr : false;
            });
            origin = "explicit";
        } else {
            const selectableIds = [...kairoIds].filter(
                (id) => world.runtimes.get(id)?.state !== AddonState.UNRESOLVED,
            );
            const stableIds = selectableIds.filter((id) => {
                const reg = world.registries.get(id);
                return reg && !SemVerUtils.isPrerelease(reg.version);
            });
            const pool = stableIds.length > 0 ? stableIds : selectableIds;
            newKairoId = pool.length > 0
                ? pool.reduce((best, cur) => {
                    const a = world.registries.get(best)!;
                    const b = world.registries.get(cur)!;
                    return SemVerUtils.compare(b.version, a.version) > 0 ? cur : best;
                  })
                : undefined;
            origin = "latest";
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

        if (currentActiveId) {
            await this.activationController.executeVersionSwitch(currentActiveId, newKairoId);
        } else {
            await this.activationController.executeEnable(newKairoId, origin);
        }
    }

    private commandEnableKairo(versionStr?: string, player?: Player): void {
        if (!this.activationController) return;
        if (this.isSwitching) {
            player?.sendMessage("§c[Kairo] §rVersion switch already in progress. Please wait.");
            return;
        }

        // Find the target standby entry
        let standbyEntry = versionStr
            ? this.standbyRegistry.findByVersionString(versionStr)
            : this.standbyRegistry.findBest();

        if (standbyEntry) {
            this.startVersionSwitch(standbyEntry.kairoId, standbyEntry.version, player);
        } else {
            // Fallback: save preference for next reload
            const world = this.activationController.world;
            const kairoIds = world.addonIdIndex.get("kairo");
            if (!kairoIds) return;

            let targetKairoId: string | undefined;
            let origin: "latest" | "explicit";

            if (versionStr) {
                targetKairoId = [...kairoIds].find((id) => {
                    const reg = world.registries.get(id);
                    return reg ? SemVerUtils.format(reg.version) === versionStr : false;
                });
                origin = "explicit";
            } else {
                const selectableIds = [...kairoIds].filter(
                    (id) => world.runtimes.get(id)?.state !== AddonState.UNRESOLVED,
                );
                const stableIds = selectableIds.filter((id) => {
                    const reg = world.registries.get(id);
                    return reg && !SemVerUtils.isPrerelease(reg.version);
                });
                const pool = stableIds.length > 0 ? stableIds : selectableIds;
                targetKairoId = pool.length > 0
                    ? pool.reduce((best, cur) => {
                        const a = world.registries.get(best)!;
                        const b = world.registries.get(cur)!;
                        return SemVerUtils.compare(b.version, a.version) > 0 ? cur : best;
                      })
                    : undefined;
                origin = "latest";
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

    private startVersionSwitch(targetKairoId: string, targetVersion: { major: number; minor: number; patch: number }, player?: Player): void {
        if (!this.apiPipeline || !this.activationController) return;

        this.isSwitching = true;
        const ver = SemVerUtils.format({ ...targetVersion, prerelease: undefined });
        console.log(`[kairo] Initiating handoff to kairoId=${targetKairoId} version=${ver}`);
        player?.sendMessage(`§b[Kairo] §rSwitching to Kairo ${ver}...`);

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
                this.ui = undefined;
                player?.sendMessage(`§a[Kairo] §rSwitch to Kairo ${ver} complete.`);
                player?.playSound("random.levelup");
            },
            () => {
                // Handoff failed — rolled back
                this.isSwitching = false;
                player?.sendMessage(`§c[Kairo] §rSwitch to Kairo ${ver} failed. Staying on current version.`);
            },
        );

        orchestrator.start(targetKairoId);
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

    private startUIOpenListener(): void {
        console.log(`[kairo] startUIOpenListener: registering listener`);
        this.runtime?.receive((id, playerName) => {
            if (id !== Kairo.UI_OPEN_EVENT) return;
            console.log(`[kairo] UI_OPEN_EVENT received: playerName=${playerName} ui=${!!this.ui}`);
            if (!this.ui) {
                console.warn(`[kairo] UI_OPEN_EVENT: ui is null, ignoring`);
                return;
            }
            system.run(() => {
                const players = world.getPlayers();
                const p = players.find(pl => pl.name === playerName);
                console.log(`[kairo] UI_OPEN_EVENT system.run: players=${players.length} found=${!!p}`);
                if (p && this.ui) void this.ui.open(p);
            });
        });
    }

    private buildUI(activationController: ActivationController): KairoUI {
        return new KairoUI(
            activationController,
            (targetKairoId, player) => {
                const entry = this.standbyRegistry.findByKairoId(targetKairoId);
                if (!entry) return false;
                this.startVersionSwitch(targetKairoId, entry.version, player);
                return true;
            },
        );
    }

    private readonly handleCommandConflict: ConstructorParameters<typeof ApiManifestController>[1] = (conflicts) => {
        const names = conflicts.map(c => `§e${c.commandName}§c`).join(", ");
        const msg = `§c[Kairo] §lコマンド互換性エラー:§r §c古いバージョンのアドオンをアンインストールしてください。\n影響コマンド: ${names}`;

        const sub = world.afterEvents.playerSpawn.subscribe((ev) => {
            if (!ev.initialSpawn) return;
            if (ev.player.commandPermissionLevel < CommandPermissionLevel.Host) return;
            ev.player.sendMessage(msg);
            world.afterEvents.playerSpawn.unsubscribe(sub);
        });
    };

    private readonly onElectionLost = (): void => {
        console.log("[kairo] Election lost — entering standby mode");
        this.router.onceRegistered((ownKairoId) => {
            if (!this.runtime || !this.properties) return;

            const version = this.properties.header.version;
            const verStr = SemVerUtils.format(version);
            console.log(`[kairo] Standby ready: kairoId=${ownKairoId} version=${verStr}`);

            // Announce standby availability to the host
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
            const version = {
                major: data.version.ma,
                minor: data.version.mi,
                patch: data.version.p,
                ...(data.version.pre !== undefined ? { prerelease: data.version.pre } : {}),
            };
            this.standbyRegistry.record(data.kairoId, version);
            console.log(
                `[kairo] Standby registered: kairoId=${data.kairoId} ` +
                `version=${SemVerUtils.format(version)}`,
            );
        } catch {}
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
        );
        this.activationController.setup();
        this.activationController.restoreFromHandoff(payload);

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

        // Re-run command compatibility check with data from handoff payload
        const manifestController = new ApiManifestController(this.registryIndex, this.handleCommandConflict);
        for (const { registry, manifest } of this.registryIndex.getAllWithManifests()) {
            manifestController.processManifest(registry.kairoId, manifest);
        }

        this.ui = this.buildUI(this.activationController);
        this.startUIOpenListener();
        this.isHost = true;
        console.log(`[kairo] onHandoffReceived complete: ui=${!!this.ui}`);

        // Flush any standby-ready messages received before we became host
        for (const msg of this.pendingStandbyMessages) {
            this.handleStandbyReady(msg);
        }
        this.pendingStandbyMessages.length = 0;

        // Save updated session (new kairo version is now host)
        saveSession(world.previousSession);

        console.log("[kairo] Handoff received — now active host.");
    };

    private readonly onInitComplete = (sessionPayload: string | null) => {
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

            this.ui = this.buildUI(this.activationController);
            this.startUIOpenListener();

            this.isHost = true;
            console.log(`[kairo] Election won — now active host: ui=${!!this.ui}`);

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
