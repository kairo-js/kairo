import type { KairoId, PendingEntry } from "./types";

export class PendingRequestStore {
    private readonly entries = new Map<string, PendingEntry>();

    create(entry: PendingEntry): void {
        this.entries.set(entry.correlationId, entry);
    }

    get(correlationId: string): PendingEntry | undefined {
        return this.entries.get(correlationId);
    }

    markCommitted(correlationId: string): void {
        const entry = this.entries.get(correlationId);
        if (entry) {
            entry.committed = true;
        }
    }

    remove(correlationId: string): void {
        this.entries.delete(correlationId);
    }

    has(correlationId: string): boolean {
        return this.entries.has(correlationId);
    }

    drainByTarget(targetKairoId: KairoId): string[] {
        const ids: string[] = [];
        for (const [id, entry] of this.entries) {
            if (entry.targetKairoId === targetKairoId) ids.push(id);
        }
        for (const id of ids) this.entries.delete(id);
        return ids;
    }

    drainAll(): string[] {
        const ids = [...this.entries.keys()];
        this.entries.clear();
        return ids;
    }
}
