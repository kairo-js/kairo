export const HandoffEventId = {
    StandbyReady: "kairo:standby-ready",
    handoffStart: (kairoId: string): string => `${kairoId}:handoff-start`,
    HandoffDone: "kairo:handoff-done",
} as const;
