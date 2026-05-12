import { compile } from "@kairo-js/utils";
import { type DiscoveryResponse, DiscoveryResponseSchema } from "./schema";

export const validateDiscoveryResponse = compile<DiscoveryResponse>(DiscoveryResponseSchema);
