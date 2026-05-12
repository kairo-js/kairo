import type { KairoRuntime } from "../../minecraft/KairoRuntime";

export interface KairoIdVerificationResult {
    readonly validIds: readonly string[];
    readonly rejectedIds: readonly string[];
}

export class KairoIdVerifier {
    constructor() {}

    verify(
        ids: readonly string[],
        registryId: string,
        runtime: KairoRuntime,
    ): KairoIdVerificationResult {
        const counts = new Map<string, number>();

        for (const id of ids) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }

        const validIds: string[] = [];
        const rejectedIds: string[] = [];

        const registry = runtime.getRegistry(registryId);

        for (const id of ids) {
            if ((counts.get(id) ?? 0) > 1) {
                rejectedIds.push(id);

                continue;
            }

            if (!registry.has(id)) {
                rejectedIds.push(id);

                continue;
            }

            validIds.push(id);
        }

        return {
            validIds,
            rejectedIds,
        };
    }
}
