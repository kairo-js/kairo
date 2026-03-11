import { Player, ScriptEventCommandMessageAfterEvent, system } from "@minecraft/server";
import { AddonPropertyManager, type AddonProperty } from "./addons/AddonPropertyManager";
import { AddonInitializer } from "./addons/router/init/AddonInitializer";
import { AddonManager, type AddonData } from "./addons/AddonManager";
import type { AddonRecords } from "./addons/record/AddonRecord";
import { SCRIPT_EVENT_IDS } from "./constants/scriptevent";
import { KairoUtils, type KairoCommand, type KairoResponse } from "./utils/KairoUtils";
import { SystemManager } from "./system/SystemManager";

type ActivateHandler = () => void | Promise<void>;
type DeactivateHandler = () => void | Promise<void>;
type ScriptEventListener = (data: KairoCommand) => void | Promise<void>;
type ScriptEventCommandHandler = (data: KairoCommand) => Promise<void | KairoResponse>;
type TickHandler = () => void | Promise<void>;

type HandlerOptions = {
    priority?: number;
};

type Assignable<T> = T | { run: T; options?: HandlerOptions };
type Stored<T> = { fn: T; priority: number };

export class Kairo {
    private static instance: Kairo;
    private initialized = false;

    private readonly addonManager: AddonManager;
    private readonly addonPropertyManager: AddonPropertyManager;
    private readonly addonInitializer: AddonInitializer;
    private readonly systemManager: SystemManager;

    private static _initHooks: Stored<ActivateHandler>[] = [];
    private static _deinitHooks: Stored<DeactivateHandler>[] = [];
    private static _commandHandler?: ScriptEventCommandHandler;
    private static _seHooks: Stored<ScriptEventListener>[] = [];

    private static _tickHooks: Stored<TickHandler>[] = [];
    private static _tickIntervalId: number | undefined;
    private static _tickEnabled = false;

    private constructor() {
        this.addonManager = AddonManager.create(this);
        this.addonPropertyManager = AddonPropertyManager.create(this);
        this.addonInitializer = AddonInitializer.create(this);
        this.systemManager = SystemManager.create(this);
    }

    private static getInstance(): Kairo {
        if (!this.instance) {
            this.instance = new Kairo();
        }
        return this.instance;
    }

    public static init(): void {
        const inst = this.getInstance();
        if (inst.initialized) return;

        inst.initialized = true;
        inst.addonInitializer.subscribeClientHooks();
    }

    public static initRouter(): void {
        this.getInstance().addonInitializer.subscribeCoreHooks();
    }

    public getSelfAddonProperty(): AddonProperty {
        return this.addonPropertyManager.getSelfAddonProperty();
    }

    public refreshSessionId(): void {
        this.addonPropertyManager.refreshSessionId();
    }

    public static awaitRegistration(): Promise<void> {
        return this.getInstance().addonInitializer.awaitRegistration();
    }

    public subscribeReceiverHooks(): void {
        this.addonManager.subscribeReceiverHooks();
    }

    public static unsubscribeInitializeHooks(): void {
        system.sendScriptEvent(SCRIPT_EVENT_IDS.UNSUBSCRIBE_INITIALIZE, "");
    }

    public static handleOnScriptEvent = async (
        data: KairoCommand,
    ): Promise<void | KairoResponse> => {
        return this.getInstance().systemManager.handleOnScriptEvent(data);
    };

    public static initSaveAddons(): void {
        this.getInstance().addonInitializer.saveAddons();
    }

    public static initActivateAddons(): void {
        const inst = this.getInstance();
        inst.addonInitializer.initActivateAddons(inst.addonInitializer.getRegisteredAddons());
    }

    public getAddonsData(): Map<string, AddonData> {
        return this.addonManager.getAddonsData();
    }

    public getAddonRecords(): AddonRecords {
        return this.addonInitializer.getAddonRecords();
    }

    public static showAddonList(player: Player): void {
        this.getInstance().addonManager.showAddonList(player);
    }

    public sendActiveRequest(sessionId: string): void {
        this.addonManager.sendActiveRequest(sessionId);
    }

    public sendDeactiveRequest(sessionId: string): void {
        this.addonManager.sendDeactiveRequest(sessionId);
    }

    public static handleAddonRouterScriptEvent = (
        ev: ScriptEventCommandMessageAfterEvent,
    ): void => {
        Kairo.getInstance().addonManager.handleAddonRouterScriptEvent(ev);
    };

    public static handleAddonListScriptEvent = (ev: ScriptEventCommandMessageAfterEvent): void => {
        Kairo.getInstance().addonManager.handleAddonListScriptEvent(ev);
    };

    public static set onActivate(val: Assignable<ActivateHandler>) {
        if (typeof val === "function") this._pushSorted(this._initHooks, val);
        else this._pushSorted(this._initHooks, val.run, val.options);
    }
    public static set onDeactivate(val: Assignable<DeactivateHandler>) {
        if (typeof val === "function") this._pushSorted(this._deinitHooks, val);
        else this._pushSorted(this._deinitHooks, val.run, val.options);
    }
    public static set onScriptEvent(val: ScriptEventCommandHandler) {
        if (this._commandHandler) {
            throw new Error("CommandHandler already registered");
        }

        this._commandHandler = val;
    }
    public static set onTick(fn: TickHandler) {
        this.addTick(fn);
    }

    public static addActivate(fn: ActivateHandler, opt?: HandlerOptions) {
        this._pushSorted(this._initHooks, fn, opt);
    }
    public static addDeactivate(fn: DeactivateHandler, opt?: HandlerOptions) {
        this._pushSorted(this._deinitHooks, fn, opt);
    }
    public static addScriptEvent(fn: ScriptEventListener, opt?: HandlerOptions) {
        this._pushSorted(this._seHooks, fn, opt);
    }

    public static addTick(fn: TickHandler, opt?: HandlerOptions) {
        this._pushSorted(this._tickHooks, fn, opt);
    }

    public async _scriptEvent(data: KairoCommand): Promise<void | KairoResponse> {
        return Kairo._runScriptEvent(data);
    }

    public _activateAddon(): void {
        void Kairo._runActivateHooks();
    }

    public _deactivateAddon(): void {
        void Kairo._runDeactivateHooks();
    }

    private static _pushSorted<T>(arr: Stored<T>[], fn: T, opt?: HandlerOptions) {
        arr.push({ fn, priority: opt?.priority ?? 0 });
        arr.sort((a, b) => b.priority - a.priority);
    }

    private static async _runActivateHooks() {
        for (const { fn } of this._initHooks) {
            try {
                await fn();
            } catch (e) {
                system.run(() =>
                    console.warn(
                        `[Kairo.onActivate] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
                    ),
                );
            }
        }

        this._enableTick();
        this.getInstance().addonManager.setActiveState(true);
    }

    private static async _runDeactivateHooks() {
        for (const { fn } of [...this._deinitHooks].reverse()) {
            try {
                await fn();
            } catch (e) {
                system.run(() =>
                    console.warn(
                        `[Kairo.onDeactivate] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
                    ),
                );
            }
        }

        this._disableTick();
        this.getInstance().addonManager.setActiveState(false);
    }

    private static async _runScriptEvent(data: KairoCommand): Promise<void | KairoResponse> {
        let response: void | KairoResponse = undefined;

        if (this._commandHandler) {
            try {
                response = await this._commandHandler(data);
            } catch (e) {
                system.run(() =>
                    console.warn(
                        `[Kairo.CommandHandler] ${
                            e instanceof Error ? (e.stack ?? e.message) : String(e)
                        }`,
                    ),
                );
            }
        }

        for (const { fn } of this._seHooks) {
            try {
                await fn(data);
            } catch (e) {
                system.run(() =>
                    console.warn(
                        `[Kairo.onScriptEvent] ${
                            e instanceof Error ? (e.stack ?? e.message) : String(e)
                        }`,
                    ),
                );
            }
        }

        return response;
    }

    private static async _runTick(): Promise<void> {
        if (!this._tickEnabled) return;

        for (const { fn } of this._tickHooks) {
            try {
                await fn();
            } catch (e) {
                system.run(() =>
                    console.warn(
                        `[Kairo.onTick] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
                    ),
                );
            }
        }
    }

    private static _enableTick(): void {
        if (this._tickIntervalId !== undefined) return;

        this._tickEnabled = true;

        this.addTick(
            () => {
                KairoUtils.onTick();
            },
            { priority: Number.MAX_SAFE_INTEGER },
        );

        this._tickIntervalId = system.runInterval(() => {
            void this._runTick();
        }, 1);
    }

    private static _disableTick(): void {
        if (this._tickIntervalId === undefined) return;

        system.clearRun(this._tickIntervalId);
        this._tickIntervalId = undefined;
        this._tickEnabled = false;
    }

    public saveAddon(addonData: AddonData): void {
        this.addonInitializer.saveAddon(addonData);
    }

    public static subscribeEvents = (): void => {
        Kairo.getInstance().systemManager.subscribeEvents();
    };

    public static unsubscribeEvents = (): void => {
        Kairo.getInstance().systemManager.unsubscribeEvents();
    };

    public static systemInitialize = (): void => {
        Kairo.getInstance().systemManager.initialize();
    };
}
