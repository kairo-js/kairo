import { type Disposable, KairoRouter, router } from "@kairo-js/router";
import { parseSession, saveSession } from "./session/SessionStorage";
import { SeedRandom, SemVerUtils } from "@kairo-js/utils";
import type { AddonProperties } from "@kairo-js/properties";
import {
    CommandPermissionLevel,
    CustomCommandParamType,
    CustomCommandStatus,
    system,
} from "@minecraft/server";
import type { CustomCommandOrigin, Player } from "@minecraft/server";
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

class Kairo {
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
        );
        this.router.waitForWorldLoad().then(() => {
            initializer.setup();
            initializer.onWorldLoad();
        });

        this.router.beforeEvents.startup.subscribe((ev) => {
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
                        { name: "version", type: CustomCommandParamType.String },
                    ],
                },
                (origin: CustomCommandOrigin, subcommand: string, addonId?: string, version?: string) => {
                    const player = origin.sourceEntity as Player;
                    if (subcommand === "list") {
                        system.run(() => {
                            this.commandList(player);
                        });
                    } else if (subcommand === "open") {
                        system.run(() => {
                            this.ui?.open(player);
                        });
                    } else if (subcommand === "enable" && addonId) {
                        const _player = player;
                        system.run(() => {
                            void this.commandEnable(addonId, version, _player);
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
                            this.commandStatus(player, addonId);
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

        if (!newKairoId) return;

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
            ? (() => {
                const parts = versionStr.split(".");
                if (parts.length < 3) return undefined;
                const ma = Number(parts[0]);
                const mi = Number(parts[1]);
                const p = Number(parts[2]);
                if (isNaN(ma) || isNaN(mi) || isNaN(p)) return undefined;
                const version = { major: ma, minor: mi, patch: p };
                return this.standbyRegistry.findByVersion(version);
            })()
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

            if (!targetKairoId) return;

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

        this.ui = new KairoUI(this.activationController);
        this.isHost = true;

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

            this.ui = new KairoUI(this.activationController);

            this.isHost = true;
            console.log("[kairo] Election won — now active host");

            // Flush buffered standby-ready messages received during init
            for (const msg of this.pendingStandbyMessages) {
                this.handleStandbyReady(msg);
            }
            this.pendingStandbyMessages.length = 0;
        })();
    };
}

export const kairo = new Kairo(router);
