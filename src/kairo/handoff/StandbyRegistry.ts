import type { SemVer } from "@kairo-js/properties";
import { SemVerUtils } from "@kairo-js/utils";

export type StandbyEntry = {
    readonly kairoId: string;
    readonly version: SemVer;
};

export class StandbyRegistry {
    private readonly entries = new Map<string, StandbyEntry>();

    record(kairoId: string, version: SemVer): void {
        this.entries.set(kairoId, { kairoId, version });
    }

    findByVersion(version: SemVer): StandbyEntry | undefined {
        for (const entry of this.entries.values()) {
            if (SemVerUtils.equals(entry.version, version)) return entry;
        }
        return undefined;
    }

    findBest(): StandbyEntry | undefined {
        let best: StandbyEntry | undefined;
        for (const entry of this.entries.values()) {
            if (!best) { best = entry; continue; }
            if (SemVerUtils.compare(entry.version, best.version) > 0) best = entry;
        }
        return best;
    }

    findByKairoId(kairoId: string): StandbyEntry | undefined {
        return this.entries.get(kairoId);
    }

    findByVersionString(versionStr: string): StandbyEntry | undefined {
        for (const entry of this.entries.values()) {
            if (SemVerUtils.format(entry.version) === versionStr) return entry;
        }
        return undefined;
    }

    getAll(): readonly StandbyEntry[] {
        return [...this.entries.values()];
    }
}
