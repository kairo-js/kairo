import { system, type Vector3 } from "@minecraft/server";
import { SCRIPT_EVENT_COMMAND_TYPES, SCRIPT_EVENT_ID_PREFIX } from "../constants/scriptevent";
import { KAIRO_COMMAND_TARGET_ADDON_IDS } from "../constants/system";
import { properties } from "../../properties";

export interface KairoCommand {
    sourceAddonId: string;
    commandId: string;
    commandType: string;
    data: Record<string, any>;
}

export interface KairoResponse extends KairoCommand {
    success: boolean;
    errorMessage?: string;
}

type PendingRequest = {
    resolve: (value?: KairoResponse) => void;
    reject: (reason?: any) => void;

    timeoutTick: number;
    expectResponse: boolean;
};

export type AllowedDynamicValue = boolean | number | string | Vector3 | null;

export type PlayerKairoState = string & { __brand: "PlayerKairoState" };
export interface PlayerKairoDataDTO {
    playerId: string;
    joinOrder: number;
    states: PlayerKairoState[];
}

export class KairoUtils {
    private static pendingRequests = new Map<string, PendingRequest>();

    public static async sendKairoCommand(
        targetAddonId: string,
        commandType: string,
        data: Record<string, any> = {},
        timeoutTicks: number = 20,
    ) {
        return this.sendInternal(targetAddonId, commandType, data, timeoutTicks, false);
    }

    public static async sendKairoCommandAndWaitResponse(
        targetAddonId: string,
        commandType: string,
        data: Record<string, any> = {},
        timeoutTicks: number = 20,
    ) {
        return this.sendInternal(targetAddonId, commandType, data, timeoutTicks, true);
    }

    public static buildKairoResponse(
        data: Record<string, any> = {},
        success: boolean = true,
        errorMessage?: string,
    ): KairoResponse {
        return {
            sourceAddonId: properties.id,
            commandId: this.generateRandomId(16),
            commandType: SCRIPT_EVENT_COMMAND_TYPES.KAIRO_RESPONSE,
            data,
            success,
            ...(errorMessage !== undefined ? { errorMessage } : {}),
        };
    }

    private static readonly charset = [
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ];

    public static generateRandomId(length: number = 8): string {
        return Array.from(
            { length },
            () => this.charset[Math.floor(Math.random() * this.charset.length)],
        ).join("");
    }

    public static async getPlayerKairoData(playerId: string): Promise<PlayerKairoDataDTO> {
        const kairoResponse = await KairoUtils.sendKairoCommandAndWaitResponse(
            KAIRO_COMMAND_TARGET_ADDON_IDS.KAIRO,
            SCRIPT_EVENT_COMMAND_TYPES.GET_PLAYER_KAIRO_DATA,
            {
                playerId,
            },
        );

        return kairoResponse.data.playerKairoData as PlayerKairoDataDTO;
    }

    public static async getPlayersKairoData(): Promise<PlayerKairoDataDTO[]> {
        const kairoResponse = await KairoUtils.sendKairoCommandAndWaitResponse(
            KAIRO_COMMAND_TARGET_ADDON_IDS.KAIRO,
            SCRIPT_EVENT_COMMAND_TYPES.GET_PLAYERS_KAIRO_DATA,
        );

        return kairoResponse.data.playersKairoData as PlayerKairoDataDTO[];
    }

    public static async saveToDataVault(key: string, value: AllowedDynamicValue): Promise<void> {
        const type = value === null ? "null" : typeof value;
        if (type === "object" && !this.isVector3(value)) {
            throw new Error(
                `Invalid value type for saveToDataVault: expected Vector3 for object, got ${JSON.stringify(value)}`,
            );
        }

        return KairoUtils.sendKairoCommand(
            KAIRO_COMMAND_TARGET_ADDON_IDS.KAIRO_DATAVAULT,
            SCRIPT_EVENT_COMMAND_TYPES.SAVE_DATA,
            {
                type,
                key,
                value: JSON.stringify(value),
            },
        );
    }

    public static async loadFromDataVault(key: string): Promise<AllowedDynamicValue> {
        const kairoResponse = await KairoUtils.sendKairoCommandAndWaitResponse(
            KAIRO_COMMAND_TARGET_ADDON_IDS.KAIRO_DATAVAULT,
            SCRIPT_EVENT_COMMAND_TYPES.LOAD_DATA,
            {
                key,
            },
        );

        const { type, value } = kairoResponse.data.dataLoaded;

        if (value === null) return null;

        switch (type) {
            case "string":
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }

            case "number":
            case "boolean":
                return JSON.parse(value);

            case "object":
                return JSON.parse(value);

            case "null":
                return null;

            default:
                throw new Error(`Unsupported DataVault value type: ${type}`);
        }
    }

    public static resolvePendingRequest(commandId: string, response?: KairoResponse): void {
        const pending = this.pendingRequests.get(commandId);
        if (!pending) return;

        this.pendingRequests.delete(commandId);

        if (pending.expectResponse && response === undefined) {
            pending.reject(
                new Error(`Kairo response expected but none received (commandId=${commandId})`),
            );
            return;
        }

        pending.resolve(response);
    }

    public static rejectPendingRequest(commandId: string, error?: unknown): void {
        const pending = this.pendingRequests.get(commandId);
        if (!pending) return;

        this.pendingRequests.delete(commandId);

        pending.reject(error ?? new Error("Kairo request rejected"));
    }

    private static async sendInternal(
        targetAddonId: string,
        commandType: string,
        data: Record<string, any>,
        timeoutTicks: number,
        expectResponse: false,
    ): Promise<void>;

    private static async sendInternal(
        targetAddonId: string,
        commandType: string,
        data: Record<string, any>,
        timeoutTicks: number,
        expectResponse: true,
    ): Promise<KairoResponse>;

    private static async sendInternal(
        targetAddonId: string,
        commandType: string,
        data: Record<string, any>,
        timeoutTicks: number,
        expectResponse: boolean,
    ): Promise<void | KairoResponse> {
        const kairoCommand: KairoCommand = {
            sourceAddonId: properties.id,
            commandId: this.generateRandomId(16),
            commandType,
            data,
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(kairoCommand.commandId, {
                expectResponse,
                resolve,
                reject,
                timeoutTick: system.currentTick + timeoutTicks,
            });

            system.sendScriptEvent(
                `${SCRIPT_EVENT_ID_PREFIX.KAIRO}:${targetAddonId}`,
                JSON.stringify(kairoCommand),
            );
        });
    }

    private static lastTick: number;
    public static onTick(): void {
        if (this.lastTick === system.currentTick) return;
        this.lastTick = system.currentTick;

        for (const [requestId, pending] of this.pendingRequests) {
            if (system.currentTick >= pending.timeoutTick) {
                this.pendingRequests.delete(requestId);
                pending.reject(new Error("Kairo command timeout"));
            }
        }
    }

    public static isRawMessage(value: unknown): boolean {
        if (value === null || typeof value !== "object") return false;
        const v: any = value;

        // -------- rawtext: RawMessage[] --------
        if (v.rawtext !== undefined) {
            if (!Array.isArray(v.rawtext)) return false;
            for (const item of v.rawtext) {
                if (!this.isRawMessage(item)) return false;
            }
        }

        // -------- score: RawMessageScore --------
        if (v.score !== undefined) {
            const s = v.score;
            if (s === null || typeof s !== "object") return false;

            if (s.name !== undefined && typeof s.name !== "string") return false;
            if (s.objective !== undefined && typeof s.objective !== "string") return false;
        }

        // -------- text: string --------
        if (v.text !== undefined && typeof v.text !== "string") {
            return false;
        }

        // -------- translate: string --------
        if (v.translate !== undefined && typeof v.translate !== "string") {
            return false;
        }

        // -------- with: string[] | RawMessage --------
        if (v.with !== undefined) {
            const w = v.with;

            // string[]
            if (Array.isArray(w)) {
                if (!w.every((item) => typeof item === "string")) return false;
            }
            // RawMessage
            else if (!this.isRawMessage(w)) {
                return false;
            }
        }

        return true;
    }

    private static isVector3(value: any): value is Vector3 {
        return (
            typeof value === "object" &&
            value !== null &&
            typeof value.x === "number" &&
            typeof value.y === "number" &&
            typeof value.z === "number" &&
            Object.keys(value).length === 3
        );
    }
}
