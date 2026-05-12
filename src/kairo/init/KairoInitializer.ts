import type { Disposable } from "@kairo-js/router";
import { type Random } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { KairoInitError, KairoInitErrorReason } from "../errors/KairoInitError";
import { KairoInitEventId } from "./constants/KairoInitEventId";
import { DiscoveryController } from "./discovery/DiscoveryController";
import { IdRegistryProvider } from "./IdRegistryProvider";
import { KairoIdVerifier } from "./KairoIdVerifier";
import { KairoInitListener } from "./KairoInitListener";
import { RegistrationController } from "./registratoin/RegistrationController";

enum InitPhase {
    Discovery,
    Registration,
    Completed,
    Disposed,
}

export class KairoInitializer implements Disposable {
    private subscription?: Disposable;
    private phase = InitPhase.Discovery;

    private readonly idRegistryProvider: IdRegistryProvider;
    private readonly kairoIdVerifier: KairoIdVerifier;

    private readonly initListener: KairoInitListener;
    private readonly discoveryController: DiscoveryController;
    private readonly registrationController: RegistrationController;

    private readonly DISCOVERY_RESPONSE_TIMEOUT_TICKS = 10;
    private readonly pendingDiscoveryResponses: string[] = [];
    constructor(
        private readonly runtime: KairoRuntime,
        private readonly random: Random,
        private readonly onCompleted?: () => void,
        private readonly onDisposed?: () => void,
    ) {
        this.idRegistryProvider = new IdRegistryProvider(this.random);
        this.kairoIdVerifier = new KairoIdVerifier();
        this.discoveryController = new DiscoveryController();
        this.registrationController = new RegistrationController();

        this.initListener = new KairoInitListener({
            [KairoInitEventId.DiscoveryResponse]: this.handleDiscoveryResponse,
            [KairoInitEventId.RegistrationResponse]: this.handleRegistrationResponse,
        });
    }

    setup(): void {
        this.assertNotDisposed();
        this.subscription = this.initListener.setup(this.runtime);
    }

    onWorldLoad(): void {
        const registryId = this.idRegistryProvider.provideRegistry(this.runtime);
        this.discoveryController.handleOnWorldLoad(registryId, { runtime: this.runtime });

        this.runtime.waitTicks(this.DISCOVERY_RESPONSE_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();

            if (this.phase !== InitPhase.Discovery) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }

            const { validIds, rejectedIds } = this.kairoIdVerifier.verify(
                this.pendingDiscoveryResponses,
                registryId,
                this.runtime,
            );

            this.runtime.removeRegistry(registryId);

            this.phase = InitPhase.Registration;
            this.onDiscoveryComplete(validIds, rejectedIds);
        });
    }

    onDiscoveryComplete(approvals: readonly string[], rejects: readonly string[]): void {
        this.registrationController.handleDiscoveryComplete(approvals, rejects, {
            runtime: this.runtime,
        });
    }

    dispose(): void {
        if (this.phase === InitPhase.Disposed) return;

        this.phase = InitPhase.Disposed;

        this.subscription?.dispose();
        this.subscription = undefined;

        try {
            this.onDisposed?.();
        } catch {}
    }

    private handleDiscoveryResponse = (message: string): void => {
        this.assertPhase(InitPhase.Discovery);

        try {
            this.discoveryController.handleDiscoveryResponse(message, {
                runtime: this.runtime,
                pendingArray: this.pendingDiscoveryResponses,
            });
        } catch (error) {
            this.dispose();
            throw error;
        }
    };

    private handleRegistrationResponse = (message: string): void => {
        this.assertPhase(InitPhase.Registration);

        try {
        } catch (error) {
            this.dispose();
            throw error;
        }
    };

    private assertNotDisposed(): void {
        if (this.phase === InitPhase.Disposed) {
            throw new KairoInitError(KairoInitErrorReason.AlreadyDisposed);
        }
    }

    private assertPhase(expected: InitPhase): void {
        if (this.phase !== expected) {
            throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
        }
    }
}
