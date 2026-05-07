import { system, world } from "@minecraft/server";

export class DynamicPropertyStorage {
    private static readonly CHUNK_SIZE = 30000;

    /**
     * オブジェクトをDynamicPropertyに保存
     */
    public static save<T>(keyPrefix: string, data: T): void {
        const json = JSON.stringify(data);
        const totalChunks = Math.ceil(json.length / this.CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const chunk = json.slice(i * this.CHUNK_SIZE, (i + 1) * this.CHUNK_SIZE);
            world.setDynamicProperty(`${keyPrefix}_${i}`, chunk);
        }

        world.setDynamicProperty(`${keyPrefix}_count`, totalChunks);
    }

    /**
     * DynamicPropertyからオブジェクトを読み込み
     */
    public static load<T>(keyPrefix: string): T {
        const count = world.getDynamicProperty(`${keyPrefix}_count`) as number;
        if (!count || count <= 0) return {} as T;

        let json = "";
        for (let i = 0; i < count; i++) {
            json += (world.getDynamicProperty(`${keyPrefix}_${i}`) as string) || "";
        }

        return JSON.parse(json) as T;
    }

    /**
     * DynamicPropertyからデータを削除
     */
    public static delete(keyPrefix: string): void {
        const count = world.getDynamicProperty(`${keyPrefix}_count`) as number;
        if (count && count > 0) {
            for (let i = 0; i < count; i++) {
                world.setDynamicProperty(`${keyPrefix}_${i}`, undefined as any);
            }
        }
        world.setDynamicProperty(`${keyPrefix}_count`, undefined as any);
    }

    /**
     * DynamicPropertyからデータをすべて削除
     */
    public static clear(): void {
        system.run(() => {
            world.clearDynamicProperties();
        });
    }
}
