import { compile } from "@kairo-js/utils";
import { RegistrationResponseSchema } from "./schema";

export const validateRegistrationResponse = compile(RegistrationResponseSchema);
