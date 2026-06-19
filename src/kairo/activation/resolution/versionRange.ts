import type { SemVer } from "@kairo-js/properties";
import { SemVerUtils } from "@kairo-js/utils";
import semver from "semver";

export function satisfiesVersionRange(
    version: SemVer,
    range: string,
    options?: { readonly includePrerelease?: boolean },
): boolean {
    if (!options?.includePrerelease) {
        return SemVerUtils.satisfies(version, range);
    }

    return semver.satisfies(SemVerUtils.format(version), range, { includePrerelease: true });
}
