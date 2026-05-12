import { DiscoveryResponseParser } from "./DiscoveryResponseParser";
import { DiscoveryResponseValidator } from "./DiscoveryResponseValidator";

export class AddonDiscoveryManager {
    private readonly parser = new DiscoveryResponseParser();
    private readonly validator = new DiscoveryResponseValidator();
    constructor() {}

    resolveKairoId(message: string, currentTick: number): string {
        const response = this.parser.parse(message);
        this.validator.validateRequest(response, currentTick);
        return response.kairoId;
    }
}
