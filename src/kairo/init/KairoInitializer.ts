import type { Disposable } from "@kairo-js/router";
import { SemVerUtils, type Random } from "@kairo-js/utils";
import type { SemVer } from "@kairo-js/properties";
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
import { ApiManifestController } from "./api/ApiManifestController";

const ELECTION_SCOREBOARD = "_kairo_election_iid";

enum InitPhase {
    Bootstrap,
    Election,
    Discovery,
    Registration,
    PackOrderProbe,
    ApiRegister,
    Completed,
    Disposed,
}

type ElectionCandidate = {
    readonly version: SemVer;
    readonly instanceId: string;
};

type SessionKairoEntry = {
    readonly version: SemVer;
    readonly origin: "explicit" | "latest";
};

export class KairoInitializer implements Disposable {
    private subscription?: Disposable;
    private phase = InitPhase.Bootstrap;

    private idRegistryProvider?: IdRegistryProvider;
    private kairoIdVerifier?: KairoIdVerifier;
    private kairoRegistryVerifier?: KairoRegistryVerifier;

    private initListener?: KairoInitListener;
    private discoveryController?: DiscoveryController;
    private registrationController?: RegistrationController;
    private apiManifestController?: ApiManifestController;

    private readonly BOOTSTRAP_TIMEOUT_TICKS = 5;
    private sessionPayload: string | null = null;

    private readonly ELECTION_TIMEOUT_TICKS = 10;
    private electionInstanceId?: string;
    private pendingElectionCandidates: ElectionCandidate[] = [];

    private readonly DISCOVERY_RESPONSE_TIMEOUT_TICKS = 10;
    private pendingDiscoveryResponses?: string[] = [];

    private readonly REGISTRATION_RESPONSE_TIMEOUT_TICKS = 10;
    private readonly PACK_ORDER_PROBE_TIMEOUT_TICKS = 5;
    private readonly API_REGISTER_TIMEOUT_TICKS = 10;

    private pendingOrderPongs: string[] = [];

    constructor(
        private readonly runtime: KairoRuntime,
        random: Random,
        private readonly registryIndex: KairoRegistryIndex,
        private readonly ownVersion: SemVer,
        private readonly onCompleted?: (sessionPayload: string | null) => void,
        private readonly onElectionLost?: () => void,
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
        this.apiManifestController = new ApiManifestController(registryIndex);

        this.initListener = new KairoInitListener({
            [KairoInitEventId.SessionResponse]: this.handleSessionResponse,
            [KairoInitEventId.ElectionAnnounce]: this.handleElectionAnnounce,
            [KairoInitEventId.DiscoveryResponse]: this.handleDiscoveryResponse,
            [KairoInitEventId.RegistrationResponse]: this.handleRegistrationResponse,
            [KairoInitEventId.OrderPong]: this.handleOrderPong,
            [KairoInitEventId.ApiManifest]: this.handleApiManifest,
        });
    }

    setup(): void {
        this.assertNotDisposed();
        this.subscription = this.initListener!.setup(this.runtime);
    }

    onWorldLoad(): void {
        this.runtime.send(KairoInitEventId.SessionRequest, "");

        this.runtime.waitTicks(this.BOOTSTRAP_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();
            if (this.phase !== InitPhase.Bootstrap) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }
            this.phase = InitPhase.Election;
            this.startElection();
        });
    }

    // ── Election ──────────────────────────────────────────────────

    private startElection(): void {
        // Create election scoreboard (may already exist from a previous crashed session)
        if (!this.runtime.hasRegistry(ELECTION_SCOREBOARD)) {
            this.runtime.addRegistry(ELECTION_SCOREBOARD, "");
        }

        // Generate a unique instanceId
        const registry = this.runtime.getRegistry(ELECTION_SCOREBOARD);
        let instanceId: string;
        do {
            instanceId = this.generateRandomHex();
        } while (registry.has(instanceId));
        registry.register(instanceId);
        this.electionInstanceId = instanceId;

        const ownVerStr = SemVerUtils.format(this.ownVersion);
        console.log(`[kairo] Election started: own=${ownVerStr} instanceId=${instanceId}`);

        // Broadcast candidacy
        const msg = JSON.stringify(this.encodeAnnounce(this.ownVersion, instanceId));
        this.runtime.send(KairoInitEventId.ElectionAnnounce, msg);

        this.runtime.waitTicks(this.ELECTION_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();
            if (this.phase !== InitPhase.Election) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }

            // Clean up election scoreboard
            try { this.runtime.removeRegistry(ELECTION_SCOREBOARD); } catch {}

            // If no announces received at all (edge case), self is the only candidate
            const candidates = this.pendingElectionCandidates.length > 0
                ? this.pendingElectionCandidates
                : [{ version: this.ownVersion, instanceId: this.electionInstanceId! }];

            const sessionKairo = this.parseSessionKairoEntry(this.sessionPayload);
            const winner = this.selectWinner(candidates, sessionKairo);
            const isWinner = winner.instanceId === this.electionInstanceId;

            console.log(
                `[kairo] Election result: ${isWinner ? "WINNER" : "LOSER"} | ` +
                `winner=${SemVerUtils.format(winner.version)} id=${winner.instanceId} | ` +
                `candidates(${candidates.length})=[${candidates.map(c => `${SemVerUtils.format(c.version)}:${c.instanceId}`).join(", ")}]`,
            );

            if (isWinner) {
                this.phase = InitPhase.Discovery;
                this.startDiscovery();
            } else {
                // Lost election — abort host initialization, guest side continues
                this.onElectionLost?.();
                this.dispose();
            }
        });
    }

    private encodeAnnounce(version: SemVer, instanceId: string): object {
        return {
            v: {
                ma: version.major,
                mi: version.minor,
                p: version.patch,
                ...(version.prerelease !== undefined ? { pre: version.prerelease } : {}),
            },
            id: instanceId,
        };
    }

    private parseElectionAnnounce(message: string): ElectionCandidate | null {
        try {
            const data = JSON.parse(message) as { v: { ma: number; mi: number; p: number; pre?: string }; id: string };
            if (typeof data.id !== "string" || typeof data.v?.ma !== "number") return null;
            return {
                version: {
                    major: data.v.ma,
                    minor: data.v.mi,
                    patch: data.v.p,
                    ...(data.v.pre !== undefined ? { prerelease: data.v.pre } : {}),
                },
                instanceId: data.id,
            };
        } catch {
            return null;
        }
    }

    private parseSessionKairoEntry(payload: string | null): SessionKairoEntry | undefined {
        if (!payload) return undefined;
        try {
            const parsed = JSON.parse(payload) as Record<string, { v: { ma: number; mi: number; p: number; pre?: string }; o: string }>;
            const entry = parsed["kairo"];
            if (!entry) return undefined;
            return {
                version: {
                    major: entry.v.ma,
                    minor: entry.v.mi,
                    patch: entry.v.p,
                    ...(entry.v.pre !== undefined ? { prerelease: entry.v.pre } : {}),
                },
                origin: entry.o === "explicit" ? "explicit" : "latest",
            };
        } catch {
            return undefined;
        }
    }

    private selectWinner(candidates: ElectionCandidate[], sessionKairo?: SessionKairoEntry): ElectionCandidate {
        // Priority 1: explicit session preference
        if (sessionKairo?.origin === "explicit") {
            const preferred = candidates.find(c => SemVerUtils.equals(c.version, sessionKairo.version));
            if (preferred) return preferred;
        }
        // Priority 2: latest (stable preferred, fallback to prerelease, tiebreak by instanceId)
        const stable = candidates.filter(c => !SemVerUtils.isPrerelease(c.version));
        const pool = stable.length > 0 ? stable : candidates;
        return pool.reduce((best, cur) => {
            const cmp = SemVerUtils.compare(cur.version, best.version);
            if (cmp > 0) return cur;
            if (cmp < 0) return best;
            return cur.instanceId < best.instanceId ? cur : best;
        });
    }

    private generateRandomHex(): string {
        const n = Math.floor(Math.random() * 0xFFFFFFFF);
        return n.toString(16).padStart(8, "0");
    }

    // ── Discovery ─────────────────────────────────────────────────

    private startDiscovery(): void {
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

            this.phase = InitPhase.PackOrderProbe;
            this.startPackOrderProbe();
        });
    }

    private startPackOrderProbe(): void {
        this.runtime.send(KairoInitEventId.OrderPing, "");

        this.runtime.waitTicks(this.PACK_ORDER_PROBE_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();

            if (this.phase !== InitPhase.PackOrderProbe) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }

            const registeredKairoIds = this.registryIndex.getAll().map(r => r.kairoId);
            const seen = new Set(this.pendingOrderPongs);
            const missing = registeredKairoIds
                .filter(id => !seen.has(id))
                .sort();
            const order = [...this.pendingOrderPongs, ...missing];
            this.registryIndex.setPackExecutionOrder(order);
            const kairoIdToLabel = new Map(this.registryIndex.getAll().map(r => [r.kairoId, `${r.addonId}@${SemVerUtils.format(r.version)}`]));
            const pongLabels = this.pendingOrderPongs.map((id, i) => `  ${i}: ${kairoIdToLabel.get(id) ?? id}`);
            const missingLabels = missing.map((id, i) => `  ${this.pendingOrderPongs.length + i}: ${kairoIdToLabel.get(id) ?? id} (no pong)`);
            const sections = ["[kairo] packExecutionOrder:", ...pongLabels];
            if (missingLabels.length > 0) sections.push("  --- missing pong ---", ...missingLabels);
            console.log(sections.join("\n"));
            console.log("[kairo] PackOrderProbe complete.");

            this.phase = InitPhase.ApiRegister;
            this.onRegistrationComplete();
        });
    }

    private onRegistrationComplete(): void {
        this.runtime.waitTicks(this.API_REGISTER_TIMEOUT_TICKS).then(() => {
            this.assertNotDisposed();

            if (this.phase !== InitPhase.ApiRegister) {
                throw new KairoInitError(KairoInitErrorReason.InvalidPhase);
            }

            this.phase = InitPhase.Completed;
            this.dispose();
            this.onCompleted?.(this.sessionPayload);
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
        this.apiManifestController = undefined;
        this.pendingDiscoveryResponses = undefined;
        this.pendingElectionCandidates = [];
        this.pendingOrderPongs = [];
    }

    // ── Event handlers ────────────────────────────────────────────

    private handleSessionResponse = (message: string): void => {
        if (this.phase !== InitPhase.Bootstrap) return;
        this.sessionPayload = message || null;
    };

    private handleElectionAnnounce = (message: string): void => {
        if (this.phase !== InitPhase.Election) return;
        const candidate = this.parseElectionAnnounce(message);
        if (candidate) {
            this.pendingElectionCandidates.push(candidate);
            console.log(`[kairo] Election: candidate received version=${SemVerUtils.format(candidate.version)} instanceId=${candidate.instanceId}`);
        }
    };

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

    private handleOrderPong = (message: string): void => {
        if (this.phase !== InitPhase.PackOrderProbe) return;

        try {
            const parsed = JSON.parse(message) as unknown;
            if (typeof parsed !== "object" || parsed === null) return;
            const kairoId = (parsed as Record<string, unknown>)["kairoId"];
            if (typeof kairoId !== "string") return;
            if (this.pendingOrderPongs.includes(kairoId)) return;

            this.pendingOrderPongs.push(kairoId);
        } catch {
            // malformed pong — ignore
        }
    };

    private handleApiManifest = (message: string): void => {
        if (this.phase !== InitPhase.ApiRegister && this.phase !== InitPhase.Registration) return;
        this.apiManifestController!.handleApiManifest(message);
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
