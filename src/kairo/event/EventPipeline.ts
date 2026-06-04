import { compile, safeJsonParse } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import type { KairoWorldState } from "../activation/types/world";
import { AddonState } from "../activation/types/state";
import type { KairoRegistryWithManifest } from "../KairoRegistryIndex";
import type { Disposable } from "@kairo-js/router";
import { Type, type Static } from "@sinclair/typebox";

const EventEmitMessageSchema = Type.Object(
    {
        emitterAddonId: Type.String(),
        eventName: Type.String(),
        payload: Type.String(),
        timestamp: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);
type EventEmitMessage = Static<typeof EventEmitMessageSchema>;
const validateEventEmitMessage = compile(EventEmitMessageSchema);

export class EventPipeline implements Disposable {
    // emitterAddonId → eventName → [subscriberKairoIds]
    private readonly routingTable = new Map<string, Map<string, string[]>>();
    private world?: KairoWorldState;
    private receiver?: Disposable;
    private disposed = false;

    constructor(private readonly runtime: KairoRuntime) {}

    initialize(registries: readonly KairoRegistryWithManifest[]): void {
        for (const { registry, manifest } of registries) {
            for (const sub of manifest.eventSubscriptions ?? []) {
                let byName = this.routingTable.get(sub.emitterAddonId);
                if (!byName) {
                    byName = new Map();
                    this.routingTable.set(sub.emitterAddonId, byName);
                }
                const subs = byName.get(sub.eventName) ?? [];
                subs.push(registry.kairoId);
                byName.set(sub.eventName, subs);
            }
        }

        this.receiver = this.runtime.receive((id, message) => {
            if (id !== "kairo:event-emit") return;
            this.handleEmit(message);
        });
    }

    setWorld(world: KairoWorldState): void {
        this.world = world;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.receiver?.dispose();
        this.receiver = undefined;
    }

    private handleEmit(rawMessage: string): void {
        const world = this.world;
        if (!world) return;

        let msg: EventEmitMessage;
        try {
            const parsed = safeJsonParse(rawMessage, () => new Error("parse failed"));
            if (!validateEventEmitMessage(parsed)) return;
            msg = parsed as EventEmitMessage;
        } catch {
            return;
        }

        const subscribers = this.routingTable
            .get(msg.emitterAddonId)
            ?.get(msg.eventName) ?? [];

        for (const subscriberKairoId of subscribers) {
            const rt = world.runtimes.get(subscriberKairoId);
            if (rt?.state !== AddonState.ACTIVE) continue;

            try {
                this.runtime.send(
                    `${subscriberKairoId}:event-deliver`,
                    rawMessage,
                );
            } catch {}
        }
    }
}
