import type { Kairo } from "..";
import type { AddonProperty } from "./AddonPropertyManager";
import { AddonActivator } from "./router/AddonActivator";
import type { AddonRecords } from "./record/AddonRecord";
import { ScriptEventCommandMessageAfterEvent, system, type Player } from "@minecraft/server";
import { AddonList } from "./ui/AddonList";
import { AddonReceiver } from "./router/AddonReceiver";
import { VersionManager } from "../utils/VersionManager";
import { AddonRouter } from "./router/AddonRouter";
import type { KairoCommand, KairoResponse } from "../utils/KairoUtils";

export type RegistrationState = "registered" | "unregistered" | "missing_requiredAddons";

export interface AddonData {
    id: string;
    name: string;
    description: [string, string];
    isActive: boolean;
    isEditable: boolean;
    selectedVersion: string;
    activeVersion: string;
    versions: {
        [version: string]: {
            isRegistered: boolean;
            registrationState: RegistrationState;
            canInitActivate?: boolean;
            sessionId?: string;
            tags?: string[];
            dependencies?: {
                module_name: string;
                version: string;
            }[];
            requiredAddons?: {
                [name: string]: string;
            };
        };
    };
}

export class AddonManager {
    private readonly activator: AddonActivator;
    private readonly receiver: AddonReceiver;
    private readonly addonRouter: AddonRouter;
    private readonly addonList: AddonList;
    private readonly addonsData: Map<string, AddonData> = new Map();

    private _isActive: boolean = false;

    private constructor(private readonly kairo: Kairo) {
        this.activator = AddonActivator.create(this);
        this.receiver = AddonReceiver.create(this);
        this.addonRouter = AddonRouter.create(this);
        this.addonList = AddonList.create(this);
    }
    public static create(kairo: Kairo): AddonManager {
        return new AddonManager(kairo);
    }

    public getAddonsData(): Map<string, AddonData> {
        return this.addonsData;
    }

    public getAddonRecords(): AddonRecords {
        return this.kairo.getAddonRecords();
    }

    public showAddonList(player: Player): void {
        this.addonList.showAddonList(player);
    }

    public getSelfAddonProperty(): AddonProperty {
        return this.kairo.getSelfAddonProperty();
    }

    public subscribeReceiverHooks(): void {
        system.afterEvents.scriptEventReceive.subscribe(this.receiver.handleScriptEvent);
    }

    public _activateAddon(): void {
        this.kairo._activateAddon();
    }

    public _deactivateAddon(): void {
        this.kairo._deactivateAddon();
    }

    public async _scriptEvent(data: KairoCommand): Promise<void | KairoResponse> {
        return this.kairo._scriptEvent(data);
    }

    public handleAddonRouterScriptEvent = (ev: ScriptEventCommandMessageAfterEvent): void => {
        this.addonRouter.handleScriptEvent(ev);
    };

    public handleAddonListScriptEvent = (ev: ScriptEventCommandMessageAfterEvent): void => {
        this.addonList.handleScriptEvent(ev);
    };

    public getLatestPreferStableVersion(id: string): string | undefined {
        const addonData = this.getAddonsData().get(id);
        if (!addonData) return undefined;

        const sorted = Object.keys(addonData.versions)
            .filter((v) => addonData.versions[v]?.isRegistered)
            .sort((a, b) => VersionManager.compare(b, a));

        if (sorted.length === 0) {
            return undefined;
        }

        const stable = sorted.find((v) => !VersionManager.fromString(v).prerelease);
        return stable ?? sorted[0]!;
    }

    public getLatestVersion(id: string): string | undefined {
        const addonData = this.getAddonsData().get(id);
        if (!addonData) return undefined;

        const latestVersion = Object.keys(addonData.versions)
            .filter((v) => addonData.versions[v]?.isRegistered)
            .sort((a, b) => VersionManager.compare(b, a))[0];

        return latestVersion ?? undefined;
    }

    public sendActiveRequest(sessionId: string): void {
        this.activator.sendActiveRequest(sessionId);
    }

    public sendDeactiveRequest(sessionId: string): void {
        this.activator.sendDeactiveRequest(sessionId);
    }

    public activateAddon(player: Player, addonData: AddonData, version: string): void {
        this.activator.activateAddon(player, addonData, version);
    }

    public deactivateAddon(player: Player, addonData: AddonData): void {
        this.activator.deactivateAddon(player, addonData);
    }

    public saveAddon(addonData: AddonData): void {
        this.kairo.saveAddon(addonData);
    }

    public get isActive(): boolean {
        return this._isActive;
    }

    public setActiveState(state: boolean): void {
        this._isActive = state;
    }
}
