import { compile } from "@kairo-js/utils";
import { RegistrationResponseSchema, type RegistrationResponse } from "./schema";

export const validateRegistrationResponse = compile<RegistrationResponse>(
    RegistrationResponseSchema,
);
