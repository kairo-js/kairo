import type { Disposable } from "@kairo-js/router";
import {
    ScriptEventCommandMessageAfterEvent,
    ScriptEventSource,
    system,
    world,
} from "@minecraft/server";

export class KairoRuntime {
    public readonly registry = {
        has(id: string): boolean {
            return world.scoreboard.getObjective(id) !== undefined;
        },

        add(id: string, displayName: string): void {
            world.scoreboard.addObjective(id, displayName);
        },
    };

    currentTick(): number {
        return system.currentTick;
    }

    send(id: string, message: string): void {
        system.sendScriptEvent(id, message);
    }

    receive(handler: (id: string, message: string) => void): Disposable {
        const listener = (ev: ScriptEventCommandMessageAfterEvent) => {
            if (ev.sourceType !== ScriptEventSource.Server) return;
            handler(ev.id, ev.message);
        };

        system.afterEvents.scriptEventReceive.subscribe(listener);

        return {
            dispose: () => system.afterEvents.scriptEventReceive.unsubscribe(listener),
        };
    }
}
