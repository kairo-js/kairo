import { router } from "@kairo-js/router";
import type { SemVer } from "@kairo-js/properties";
import type { PreviousSessionEntry, PreviousSessionStore } from "../activation/types/world";

const SESSION_KEY = "_kairo_session";

type StoredEntry = {
    v: { ma: number; mi: number; p: number; pre?: string };
    o: "explicit" | "latest";
    d?: true;
};
type StoredSession = Record<string, StoredEntry>;

export function parseSession(payload: string | null): PreviousSessionStore {
    const store: PreviousSessionStore = new Map();
    if (!payload) return store;

    let parsed: StoredSession;
    try {
        parsed = JSON.parse(payload) as StoredSession;
    } catch {
        return store;
    }

    for (const [addonId, entry] of Object.entries(parsed)) {
        const version: SemVer = {
            major: entry.v.ma,
            minor: entry.v.mi,
            patch: entry.v.p,
            ...(entry.v.pre !== undefined ? { prerelease: entry.v.pre } : {}),
        };
        store.set(addonId, {
            version,
            origin: entry.o,
            ...(entry.d ? { disabled: true } : {}),
        } satisfies PreviousSessionEntry);
    }

    return store;
}

function serializeSession(session: PreviousSessionStore): StoredSession {
    const obj: StoredSession = {};
    for (const [addonId, entry] of session) {
        obj[addonId] = {
            v: {
                ma: entry.version.major,
                mi: entry.version.minor,
                p: entry.version.patch,
                ...(entry.version.prerelease !== undefined ? { pre: entry.version.prerelease } : {}),
            },
            o: entry.origin,
            ...(entry.disabled ? { d: true } : {}),
        };
    }
    return obj;
}

export function buildSessionPayload(session: PreviousSessionStore): string {
    return JSON.stringify(serializeSession(session));
}

export function saveSession(session: PreviousSessionStore): void {
    router.save(SESSION_KEY, serializeSession(session)).catch(() => {});
}
