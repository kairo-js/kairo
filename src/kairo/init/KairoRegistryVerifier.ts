import type { KairoRegistry } from "@kairo-js/router";
import type { KairoRegistryQueryable } from "../KairoRegistryIndex";

export enum KairoRegistryRejectReason {
    DuplicateAddonVersion = "DuplicateAddonVersion",
}

export type KairoRegistryVerificationResult =
    | {
          readonly success: true;
      }
    | {
          readonly success: false;
          readonly reason: KairoRegistryRejectReason;
      };

export class KairoRegistryVerifier {
    constructor(private readonly queryable: KairoRegistryQueryable) {}

    verify(registry: KairoRegistry): KairoRegistryVerificationResult {
        if (this.queryable.hasAddonVersion(registry.addonId, registry.version)) {
            return {
                success: false,
                reason: KairoRegistryRejectReason.DuplicateAddonVersion,
            };
        }

        return {
            success: true,
        };
    }
}
