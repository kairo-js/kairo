import type { Disposable } from "@kairo-js/router";
import { type Random } from "@kairo-js/utils";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { KairoInitError, KairoInitErrorReason } from "../errors/KairoInitError";
import type { KairoRegistryIndex } from "../KairoRegistryIndex";
import { KairoInitEventId } from "./constants/KairoInitEventId";
import { DiscoveryController } from "./discovery/DiscoveryController";
import { IdRegistryProvider } from "./IdRegistryProvider";
import { KairoIdVerifier } from "./KairoIdVerifier";
import { KairoInitListener } from "./KairoInitListener";
import { KairoRegistryVerifier } from "./KairoRegistryVerifier";
import { RegistrationController } from "./registration/RegistrationController";

enum InitPhase {
    Discovery,
    Registration,
    Completed,
    Disposed,
}

export class KairoInitializer implements Disposable {
    private subscription?: Disposable;
    private phase = InitPhase.Discovery;

    private idRegistryProvider?: IdRegistryProvider;
    private kairoIdVerifier?: KairoIdVerifier;
    private kairoRegistryVerifier?: KairoRegistryVerifier;

    private initListener?: KairoInitListener;
    private discoveryController?: DiscoveryController;
    private registrationController?: RegistrationController;

    private readonly DISCOVERY_RESPONSE_TIMEOUT_TICKS = 10;
    private pendingDiscoveryResponses?: string[] = [];

    private readonly REGISTRATION_RESPONSE_TIMEOUT_TICKS = 10;
    constructor(
        private readonly runtime: KairoRuntime,
        random: Random,
        registryIndex: KairoRegistryIndex,
        private readonly onCompleted?: () => void,
        private readonly onDisposed?: () => void,
    ) {
        this.idRegistryProvider = new IdRegistryProvider(random);
        this.kairoIdVerifier = new KairoIdVerifier();
        this.kairoRegistryVerifier = new KairoRegistryVerifier(registryIndex);
        this.discoveryController = new DiscoveryController();
        this.registrationController = new RegistrationController(
            registryIndex,
            this.kairoRegistryVerifier,
        );

        this.initListener = new KairoInitListener({
            [KairoInitEventId.DiscoveryResponse]: this.handleDiscoveryResponse,
            [KairoInitEventId.RegistrationResponse]: this.handleRegistrationResponse,
        });
    }

    setup(): void {
        this.assertNotDisposed();
        this.subscription = this.initListener!.setup(this.runtime);
    }

    onWorldLoad(): void {
        const registryId = this.idRegistryProvider!.provideRegistry(this.runtime);
        this.discoveryController!.handleOnWorldLoad(registryId, { runtime: this.runtime });

        this.runtime.waitTicks(this.DISCOVERY_RESPONSE_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();

            if (this.phase !== InitPhase.Discovery) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }

            const { validIds, rejectedIds } = this.kairoIdVerifier!.verify(
                this.pendingDiscoveryResponses!,
                registryId,
                this.runtime,
            );

            this.runtime.removeRegistry(registryId);

            this.phase = InitPhase.Registration;
            this.onDiscoveryComplete(validIds, rejectedIds);
        });
    }

    onDiscoveryComplete(approvals: readonly string[], rejects: readonly string[]): void {
        this.registrationController!.handleDiscoveryComplete(approvals, rejects, {
            runtime: this.runtime,
        });

        this.runtime.waitTicks(this.REGISTRATION_RESPONSE_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();

            if (this.phase !== InitPhase.Registration) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }

            this.phase = InitPhase.Completed;

            // Initialization is complete; activation can begin from the onCompleted callback.
            this.dispose();
            this.onCompleted?.();
        });
    }

    dispose(): void {
        if (this.phase === InitPhase.Disposed) return;

        this.phase = InitPhase.Disposed;

        this.subscription?.dispose();
        this.subscription = undefined;

        this.releaseInitResources();

        try {
            this.onDisposed?.();
        } catch {}
    }

    private releaseInitResources(): void {
        this.idRegistryProvider = undefined;
        this.kairoIdVerifier = undefined;
        this.kairoRegistryVerifier = undefined;
        this.initListener = undefined;
        this.discoveryController = undefined;
        this.registrationController = undefined;
        this.pendingDiscoveryResponses = undefined;
    }

    private handleDiscoveryResponse = (message: string): void => {
        this.assertPhase(InitPhase.Discovery);

        try {
            this.discoveryController!.handleDiscoveryResponse(message, {
                runtime: this.runtime,
                pendingArray: this.pendingDiscoveryResponses!,
            });
        } catch (error) {
            this.dispose();
            throw error;
        }
    };

    private handleRegistrationResponse = (message: string): void => {
        this.assertPhase(InitPhase.Registration);

        try {
            this.registrationController!.handleRegistrationResponse(message, {
                runtime: this.runtime,
            });
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
