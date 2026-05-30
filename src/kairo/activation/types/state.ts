export type KairoId = string;
export type AddonId = string;

export enum AddonState {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    UNRESOLVED = "UNRESOLVED",
}

export enum InactiveReasonCode {
    ACTIVATION_FAILED = "ACTIVATION_FAILED",
    ACTIVATION_TIMEOUT = "ACTIVATION_TIMEOUT",
    MANUALLY_DEACTIVATED = "MANUALLY_DEACTIVATED",
    CASCADE_DEACTIVATED = "CASCADE_DEACTIVATED",
    DEPENDENCY_INACTIVE = "DEPENDENCY_INACTIVE",
    ADDON_ID_CONFLICT = "ADDON_ID_CONFLICT",
    PRERELEASE_ONLY = "PRERELEASE_ONLY",
}

export type InactiveReasonItem = {
    readonly code: InactiveReasonCode;
    readonly message: string;
    readonly related?: readonly string[];
};

export type InactiveReasons = Map<InactiveReasonCode, InactiveReasonItem>;

export enum UnresolvedReasonCode {
    DEPENDENCY_NOT_FOUND = "DEPENDENCY_NOT_FOUND",
    DEPENDENCY_UNRESOLVED = "DEPENDENCY_UNRESOLVED",
    VERSION_NOT_SATISFIED = "VERSION_NOT_SATISFIED",
    CIRCULAR_DEPENDENCY = "CIRCULAR_DEPENDENCY",
    PARSE_ERROR = "PARSE_ERROR",
}

export type UnresolvedReasonItem = {
    readonly code: UnresolvedReasonCode;
    readonly message: string;
    readonly related?: readonly string[];
};

export type UnresolvedReasons = Map<UnresolvedReasonCode, UnresolvedReasonItem>;

export type AddonRuntimeState = {
    readonly kairoId: KairoId;
    state: AddonState;
    inactiveReasons: InactiveReasons;
    unresolvedReasons: UnresolvedReasons;
};

export type AddonDependencySpec = {
    readonly addonId: AddonId;
    readonly versionRange: string;
};
