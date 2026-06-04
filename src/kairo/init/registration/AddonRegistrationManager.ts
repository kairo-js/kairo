import type { KairoRegistry } from "@kairo-js/router";
import { RegistrationResponseParser } from "./RegistrationResponseParser";
import { RegistrationResponseValidator } from "./RegistrationResponseValidator";

export class AddonRegistrationManager {
    private readonly parser = new RegistrationResponseParser();
    private readonly validator = new RegistrationResponseValidator();
    constructor() {}

    resolveRegistration(message: string, currentTick: number): KairoRegistry {
        const response = this.parser.parse(message);
        this.validator.validateRequest(response, currentTick);
        return response.kairoRegistry;
    }
}
