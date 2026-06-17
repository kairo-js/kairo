import { safeJsonParse } from "@kairo-js/utils";
import type { KairoRegistryIndex } from "../../KairoRegistryIndex";
import { type ApiManifest, validateApiManifestMessage } from "./ApiManifestSchema";

export class ApiManifestController {
    constructor(
        private readonly kairoRegistryIndex: KairoRegistryIndex,
    ) {}

    processManifest(kairoId: string, manifest: ApiManifest): void {
        this.kairoRegistryIndex.setManifest(kairoId, manifest);
    }

    handleApiManifest(message: string): void {
        const parsed = safeJsonParse(message, () => new Error("api_manifest: JSON parse failed"));

        const valid = validateApiManifestMessage(parsed);
        if (!valid) {
            return;
        }

        const { kairoId, apis, hooks, eventSubscriptions } = parsed;

        const manifest: ApiManifest = { apis, hooks, eventSubscriptions };
        this.kairoRegistryIndex.setManifest(kairoId, manifest);
    }
}
