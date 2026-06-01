import { compile } from "@kairo-js/utils";
import { DiscoveryResponseSchema } from "./schema";

export const validateDiscoveryResponse = compile(DiscoveryResponseSchema);
