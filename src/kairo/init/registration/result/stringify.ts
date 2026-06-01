import fastJson from "fast-json-stringify";
import { RegistrationResultSchema, type RegistrationResult } from "./schema";

export const stringifyRegistrationResult: (result: RegistrationResult) => string =
    fastJson(RegistrationResultSchema);
