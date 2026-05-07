import { system, world } from "@minecraft/server";
import { AddonInitializeReceive } from "./AddonInitializeReceive";
import { AddonInitializeRegister } from "./AddonInitializeRegister";
import { AddonInitializeRequest } from "./AddonInitializeRequest";
import { AddonInitializeResponse } from "./AddonInitializeResponse";
import { AddonRecord, type AddonRecords } from "../../record/AddonRecord";
import type { Kairo } from "../../..";
import type { AddonProperty } from "../../AddonPropertyManager";
import { AddonInitializeActivator } from "./AddonInitializeActivator";
import type { AddonData } from "../../AddonManager";
import { SCRIPT_EVENT_IDS, SCRIPT_EVENT_MESSAGES } from "../../../constants/scriptevent";

export class AddonInitializer {
    private registrationNum: number = 0;

    private readonly activator: AddonInitializeActivator;
    private readonly receive: AddonInitializeReceive;
    private readonly register: AddonInitializeRegister;
    private readonly request: AddonInitializeRequest;
    private readonly response: AddonInitializeResponse;
    private readonly record: AddonRecord;

    private constructor(private readonly kairo: Kairo) {
        this.activator = AddonInitializeActivator.create(this);
        this.receive = AddonInitializeReceive.create(this);
        this.register = AddonInitializeRegister.create(this);
        this.request = AddonInitializeRequest.create(this);
        this.response = AddonInitializeResponse.create(this);
        this.record = AddonRecord.create(this);
    }

    public static create(kairo: Kairo): AddonInitializer {
        return new AddonInitializer(kairo);
    }

    public subscribeClientHooks() {
        system.afterEvents.scriptEventReceive.subscribe(this.receive.handleScriptEvent);
    }

    public unsubscribeClientHooks() {
        system.afterEvents.scriptEventReceive.unsubscribe(this.receive.handleScriptEvent);
    }

    public getSelfAddonProperty(): AddonProperty {
        return this.kairo.getSelfAddonProperty();
    }

    public refreshSessionId(): void {
        return this.kairo.refreshSessionId();
    }

    public sendResponse(): void {
        const selfAddonProperty = this.getSelfAddonProperty();
        this.response.sendResponse(selfAddonProperty);
    }

    public setRegistrationNum(num: number): void {
        this.registrationNum = num;
    }

    public getRegistrationNum(): number {
        return this.registrationNum;
    }

    public sendInitializationCompleteResponse(): void {
        this.response.sendInitializationCompleteResponse();
    }

    /**
     * WorldLoadとScriptEventReceiveに、BehaviorInitializeのハンドルを追加する
     * Add BehaviorInitialize handles to WorldLoad and ScriptEventReceive
     */
    public subscribeCoreHooks() {
        world.afterEvents.worldLoad.subscribe(this.request.handleWorldLoad);
        system.afterEvents.scriptEventReceive.subscribe(this.register.handleScriptEventReceive);
    }

    public unsubscribeCoreHooks() {
        world.afterEvents.worldLoad.unsubscribe(this.request.handleWorldLoad);
        system.afterEvents.scriptEventReceive.unsubscribe(this.register.handleScriptEventReceive);
    }

    public getAllPendingAddons(): AddonProperty[] {
        return this.register.getAll();
    }

    public awaitRegistration(): Promise<void> {
        return this.register.ready;
    }

    public saveAddon(addonData: AddonData): void {
        this.record.saveAddon(addonData);
    }

    public saveAddons(): void {
        this.record.saveAddons(this.register.getAll());
    }

    public getAddonsData(): Map<string, AddonData> {
        return this.kairo.getAddonsData();
    }

    public getAddonRecords(): AddonRecords {
        return this.record.loadAddons();
    }

    public getRegisteredAddons(): AddonProperty[] {
        return this.register.getAll();
    }

    public subscribeReceiverHooks(): void {
        this.kairo.subscribeReceiverHooks();
    }

    public sendActiveRequest(sessionId: string): void {
        this.kairo.sendActiveRequest(sessionId);
    }

    public sendDeactiveRequest(sessionId: string): void {
        this.kairo.sendDeactiveRequest(sessionId);
    }

    public initActivateAddons(addons: AddonProperty[]): void {
        this.activator.initActivateAddons(addons);
    }
}
