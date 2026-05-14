import { compile } from "@kairo-js/utils";
import { ActivationResponseSchema } from "./schema";

export const validateActivationResponse = compile(ActivationResponseSchema);
