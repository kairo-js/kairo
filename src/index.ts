import { system } from "@minecraft/server";
import { Kairo } from "./Kairo/index";
import type { KairoCommand, KairoResponse } from "./Kairo/utils/KairoUtils";

async function main(): Promise<void> {
    /**
     * DynamicPropertyをすべてクリアするメソッド (開発用)
     */
    // DynamicPropertyStorage.clear();

    Kairo.init(); // client
    Kairo.initRouter();

    await Kairo.awaitRegistration();
    Kairo.unsubscribeInitializeHooks();

    Kairo.initSaveAddons();
    Kairo.initActivateAddons();
}

Kairo.onActivate = () => {
    /**
     * ここにアドオン有効化時の初期化処理を書く
     * Write the initialization logic executed when the addon becomes active
     */
    system.afterEvents.scriptEventReceive.subscribe(Kairo.handleAddonRouterScriptEvent);
    system.afterEvents.scriptEventReceive.subscribe(Kairo.handleAddonListScriptEvent);
    Kairo.subscribeEvents();
    Kairo.systemInitialize();
};

Kairo.onDeactivate = () => {
    /**
     * ここにアドオン無効化時の終了処理を書く
     * 基本的には初期化時の処理を無効化するように
     * Write the shutdown/cleanup logic executed when the addon becomes deactive
     * In principle, undo/disable what was done during initialization
     */
    system.afterEvents.scriptEventReceive.unsubscribe(Kairo.handleAddonRouterScriptEvent);
    system.afterEvents.scriptEventReceive.unsubscribe(Kairo.handleAddonListScriptEvent);
    Kairo.unsubscribeEvents();
};

Kairo.onScriptEvent = async (command: KairoCommand): Promise<void | KairoResponse> => {
    /**
     * ここにはアドオンが scriptEvent を受け取った際の処理を書く
     * 利用できるプロパティは { data: KairoCommand } のみ
     * Write the handler logic for when the addon receives a scriptEvent
     * The only available property is { data: KairoCommand }
     */
    return Kairo.handleOnScriptEvent(command);
};

Kairo.onTick = () => {
    /**
     * 毎 tick 実行される処理を定義します。
     * onActivate が呼ばれると有効化され、onDeactivate が呼ばれると無効化されます。
     * Defines logic that is executed on every tick.
     * It becomes active when onActivate is called and is disabled when onDeactivate is called.
     */
};

main();
