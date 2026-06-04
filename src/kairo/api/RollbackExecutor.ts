import type { RollbackFn } from "./types";

type RollbackFrame = {
    readonly rollbackFn: RollbackFn;
    readonly rollbackData: unknown;
};

export class RollbackExecutor {
    private readonly stack: RollbackFrame[] = [];

    push(rollbackFn: RollbackFn, data: unknown): void {
        this.stack.push({ rollbackFn, rollbackData: data });
    }

    async execute(initialArgs: unknown, callerAddonId: string): Promise<void> {
        let currentArgs: unknown = initialArgs;

        while (this.stack.length > 0) {
            const frame = this.stack.pop()!;
            try {
                const returned = await frame.rollbackFn({
                    rollbackData: frame.rollbackData,
                    currentArgsSnapshot: currentArgs,
                    callerAddonId,
                });
                if (returned !== undefined) {
                    currentArgs = returned;
                }
            } catch {
                // rollback errors are silently swallowed
            }
        }
    }

    clear(): void {
        this.stack.length = 0;
    }
}
