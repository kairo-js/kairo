import type { SemVer } from "@kairo-js/properties";
import type { KairoRegistry } from "@kairo-js/router";
import type { AddonId, AddonRuntimeState, KairoId } from "./state";

export type PreviousSessionEntry = {
    readonly version: SemVer;
    readonly origin: "explicit" | "latest";
    readonly disabled?: boolean;
};

export type PreviousSessionStore = Map<AddonId, PreviousSessionEntry>;

export type KairoWorldState = {
    readonly registries: Map<KairoId, KairoRegistry>;
    readonly runtimes: Map<KairoId, AddonRuntimeState>;
    readonly addonIdIndex: Map<AddonId, Set<KairoId>>;
    previousSession: PreviousSessionStore;
    cachedDeclaredReverseGraph?: ReadonlyMap<KairoId, ReadonlySet<KairoId>>;
};
