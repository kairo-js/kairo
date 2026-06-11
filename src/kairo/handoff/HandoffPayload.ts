export const HANDOFF_PROTOCOL = 1 as const;
export const HANDOFF_DB_KEY = "_kairo_handoff";

export type HandoffPayload = {
    readonly protocol: typeof HANDOFF_PROTOCOL;
    readonly registries: readonly HandoffRegistryEntry[];
    readonly runtimes: readonly HandoffRuntimeEntry[];
    readonly previousSession: Readonly<Record<string, HandoffSessionEntry>>;
    readonly activationOrder: readonly string[];
};

export type HandoffSemVer = {
    readonly ma: number;
    readonly mi: number;
    readonly p: number;
    readonly pre?: string;
};

export type HandoffRegistryEntry = {
    readonly kairoId: string;
    readonly addonId: string;
    readonly version: HandoffSemVer;
    readonly name: string;
    readonly description: string;
    readonly metadata: {
        readonly authors: readonly string[];
        readonly url?: string;
        readonly license?: string;
    };
    readonly dependencies: Readonly<Record<string, string>>;
    readonly optionalDependencies: Readonly<Record<string, string>>;
    readonly tags: readonly string[];
    readonly manifest: HandoffManifest;
};

export type HandoffManifest = {
    readonly apis: ReadonlyArray<{ readonly name: string }>;
    readonly hooks: ReadonlyArray<{
        readonly targetAddonId: string;
        readonly apiName: string;
        readonly priority: number;
        readonly phases: readonly string[];
        readonly declarationSequence: number;
        readonly hasRollback: boolean;
    }>;
    readonly eventSubscriptions: ReadonlyArray<{
        readonly emitterAddonId: string;
        readonly eventName: string;
    }>;
    readonly commands: ReadonlyArray<{
        readonly name: string;
        readonly mandatoryParameters: ReadonlyArray<{ readonly name: string; readonly type: string }>;
        readonly optionalParameters: ReadonlyArray<{ readonly name: string; readonly type: string }>;
    }>;
};

export type HandoffRuntimeEntry = {
    readonly kairoId: string;
    readonly state: "ACTIVE" | "INACTIVE" | "UNRESOLVED";
    readonly inactiveReasons: ReadonlyArray<{
        readonly code: string;
        readonly message: string;
        readonly related?: readonly string[];
    }>;
    readonly unresolvedReasons: ReadonlyArray<{
        readonly code: string;
        readonly message: string;
        readonly related?: readonly string[];
    }>;
};

export type HandoffSessionEntry = {
    readonly v: HandoffSemVer;
    readonly o: "explicit" | "latest";
    readonly d?: true;
};
