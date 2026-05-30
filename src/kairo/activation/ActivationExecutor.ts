import type { Disposable } from "@kairo-js/router";
import type { KairoRuntime } from "../../minecraft/KairoRuntime";
import { ActivationEventId } from "./constants/ActivationEventId";
import { ActivationRequestSender } from "./protocol/ActivationRequestSender";
import { ActivationResponseParser } from "./protocol/ActivationResponseParser";
import { ActivationResponseValidator } from "./protocol/ActivationResponseValidator";
import type { ActivationOutcome } from "./types/context";
import type { KairoId } from "./types/state";

const ACTIVATION_TIMEOUT_TICKS = 200;

export class ActivationExecutor {
    private readonly requestSender = new ActivationRequestSender();
    private readonly responseParser = new ActivationResponseParser();
    private readonly responseValidator = new ActivationResponseValidator();

    constructor(private readonly runtime: KairoRuntime) {}

    activate(kairoId: KairoId): Promise<ActivationOutcome> {
        return this.execute(kairoId, "activate");
    }

    deactivate(kairoId: KairoId): Promise<ActivationOutcome> {
        return this.execute(kairoId, "deactivate");
    }

    sendDeactivateFireAndForget(kairoId: KairoId): void {
        try {
            this.requestSender.send(kairoId, "deactivate", this.runtime);
        } catch {
            // ignore
        }
    }

    private execute(kairoId: KairoId, action: "activate" | "deactivate"): Promise<ActivationOutcome> {
        return new Promise((resolve) => {
            let listenerDisposable: Disposable | null = null;
            let timeoutDisposable: Disposable | null = null;

            const cleanup = (): void => {
                listenerDisposable?.dispose();
                timeoutDisposable?.dispose();
                listenerDisposable = null;
                timeoutDisposable = null;
            };

            listenerDisposable = this.runtime.receive((id, message) => {
                if (id !== ActivationEventId.ActivationResponse) return;

                let response;
                try {
                    response = this.responseParser.parse(message);
                    this.responseValidator.validateRequest(response, this.runtime.currentTick());
                } catch {
                    return;
                }

                if (response.kairoId !== kairoId) return;
                if (response.action !== action) return;

                cleanup();

                if (response.status === "success") {
                    resolve({ type: "SUCCESS" });
                } else {
                    resolve({ type: "FAILED", reason: response.reason });
                }
            });

            timeoutDisposable = this.runtime.runTimeout(() => {
                cleanup();
                resolve({ type: "TIMEOUT" });
            }, ACTIVATION_TIMEOUT_TICKS);

            try {
                this.requestSender.send(kairoId, action, this.runtime);
            } catch {
                cleanup();
                resolve({ type: "FAILED", reason: "Failed to send activation request" });
            }
        });
    }
}
