import { ActivationRequestSender } from "./ActivationRequestSender";
import { ActivationResponseListener } from "./ActivationResponseListener";
import { AddonActivationManager } from "./AddonActivationManager";

import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import {
    StartupActivationExecutor,
    type ActivationRequester,
} from "../activation/StartupActivationExecutor";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";
import { ActivationState } from "./ActivationState";
import { AddonDependencyResolver } from "./AddonDependencyResolver";
import { ActivationEventId } from "./constants/ActivationEventId";
import type { ActivationResult } from "./result/schema";
import { StartupActivationPlanner } from "./StartupActivationPlanner";

interface PendingActivationRequest {
    readonly resolve: (result: ActivationResult) => void;

    readonly reject: (reason?: unknown) => void;
}

export class ActivationController implements ActivationRequester {
    private setupCompleted = false;
    private readonly ACTIVATION_TIMEOUT_TICK = 20;

    private readonly activationManager = new AddonActivationManager();
    private readonly pendingRequests = new Map<string, PendingActivationRequest>();

    private readonly activationResponseListener: ActivationResponseListener;
    private readonly activationRequestSender = new ActivationRequestSender();

    private readonly activationState = new ActivationState();
    private readonly addonDependencyResolver: AddonDependencyResolver;
    private readonly startupActivationPlanner: StartupActivationPlanner;
    private readonly startupActivationExecutor: StartupActivationExecutor;

    constructor(
        private readonly runtime: KairoRuntime,
        private readonly kairoRegistryIndex: KairoRegistryQueryable,
    ) {
        this.activationResponseListener = new ActivationResponseListener({
            [ActivationEventId.ActivationResponse]: this.handleActivationResponse,
        });

        this.addonDependencyResolver = new AddonDependencyResolver(kairoRegistryIndex);
        this.startupActivationPlanner = new StartupActivationPlanner(
            kairoRegistryIndex,
            this.addonDependencyResolver,
        );
        this.startupActivationExecutor = new StartupActivationExecutor(this.activationState, this);
    }

    setup(): void {
        this.activationResponseListener.setup(this.runtime);
        this.setupCompleted = true;
    }

    async startupActivate(): Promise<void> {
        const plan = this.startupActivationPlanner.createPlan();

        await this.startupActivationExecutor.execute(plan);
    }

    async requestActivation(kairoId: string): Promise<ActivationResult> {
        if (!this.setupCompleted) {
            throw new Error("ActivationController setup not completed.");
        }

        if (this.pendingRequests.has(kairoId)) {
            throw new Error(`Activation request already pending: ${kairoId}`);
        }

        return new Promise<ActivationResult>((resolve, reject) => {
            this.pendingRequests.set(kairoId, {
                resolve,
                reject,
            });

            this.runtime.runTimeout(() => {
                const pending = this.pendingRequests.get(kairoId);

                if (!pending) {
                    return;
                }

                this.pendingRequests.delete(kairoId);

                pending.resolve({
                    kairoId,
                    status: "timeout",
                    action: "activate",
                });
            }, this.ACTIVATION_TIMEOUT_TICK);

            try {
                this.activationRequestSender.send(kairoId, "activate", this.runtime);
            } catch (error) {
                this.pendingRequests.delete(kairoId);

                reject(error);
            }
        });
    }

    private handleActivationResponse = (message: string): void => {
        const result = this.activationManager.resolveActivationResult(
            message,
            this.runtime.currentTick(),
        );
        if (!result) return;

        const pending = this.pendingRequests.get(result.kairoId);
        if (!pending) return;

        this.pendingRequests.delete(result.kairoId);
        pending.resolve(result);
    };
}
