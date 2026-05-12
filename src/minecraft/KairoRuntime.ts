import type { Disposable } from "@kairo-js/router";
import {
    ScriptEventCommandMessageAfterEvent,
    ScriptEventSource,
    system,
    world,
} from "@minecraft/server";

export class KairoRuntime {
    currentTick(): number {
        return system.currentTick;
    }

    waitTicks(ticks: number): Promise<void> {
        return system.waitTicks(ticks);
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

    getRegistry(id: string): {
        id: string;
        displayName: string;
        has(displayName: string): boolean;
    } {
        if (!this.hasRegistry(id)) {
            throw new Error(`Objective with id "${id}" does not exist.`);
        }
        const objective = world.scoreboard.getObjective(id)!;
        return {
            id: objective.id,
            displayName: objective.displayName,
            has(displayName: string): boolean {
                return objective.hasParticipant(displayName);
            },
        };
    }

    hasRegistry(id: string): boolean {
        return world.scoreboard.getObjective(id) !== undefined;
    }

    addRegistry(id: string, displayName: string): void {
        world.scoreboard.addObjective(id, displayName);
    }

    removeRegistry(id: string): void {
        world.scoreboard.removeObjective(id);
    }
}
