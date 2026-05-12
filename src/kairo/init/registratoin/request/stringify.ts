import fastJson from "fast-json-stringify";
import { RegistrationRequestSchema, type RegistrationRequest } from "./schema";

export const stringifyRegistrationRequest: (request: RegistrationRequest) => string =
    fastJson(RegistrationRequestSchema);
