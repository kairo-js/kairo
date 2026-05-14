import fastJson from "fast-json-stringify";
import { type ActivationRequest, ActivationRequestSchema } from "./schema";

export const stringifyActivationRequest: (query: ActivationRequest) => string =
    fastJson(ActivationRequestSchema);
