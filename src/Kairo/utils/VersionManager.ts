import type { SemVer } from "../../properties";

export class VersionManager {
    public static toVersionString(v: SemVer): string {
        let s = `${v.major}.${v.minor}.${v.patch}`;
        if (v.prerelease) s += `-${v.prerelease}`;
        if (v.build) s += `+${v.build}`;
        return s;
    }

    public static toTriple(v: SemVer): [number, number, number] {
        return [v.major, v.minor, v.patch];
    }

    public static fromString(ver: string): SemVer {
        const semverRegex =
            /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+(?<build>[0-9A-Za-z.-]+))?$/;

        const m = semverRegex.exec(ver);
        if (!m || !m.groups) {
            throw new Error(`Invalid semver: ${ver}`);
        }

        const g = m.groups as {
            major: string;
            minor: string;
            patch: string;
            prerelease?: string;
            build?: string;
        };

        return {
            major: parseInt(g.major, 10),
            minor: parseInt(g.minor, 10),
            patch: parseInt(g.patch, 10),
            prerelease: g.prerelease ?? "", // string | undefined でOK
            build: g.build ?? "", // string | undefined でOK
        };
    }

    public static compare(a: string, b: string): number {
        const va = this.fromString(a);
        const vb = this.fromString(b);

        if (va.major !== vb.major) return va.major - vb.major;
        if (va.minor !== vb.minor) return va.minor - vb.minor;
        if (va.patch !== vb.patch) return va.patch - vb.patch;

        if (va.prerelease && !vb.prerelease) return -1;
        if (!va.prerelease && vb.prerelease) return 1;
        if (va.prerelease && vb.prerelease) {
            return va.prerelease.localeCompare(vb.prerelease, undefined, { numeric: true });
        }

        return 0;
    }
}
