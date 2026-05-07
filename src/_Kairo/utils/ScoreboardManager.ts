import { ScoreboardObjective, world } from "@minecraft/server";

export class ScoreboardManager {
    public static ensureObjective(objectiveId: string): ScoreboardObjective {
        return (
            world.scoreboard.getObjective(objectiveId) ?? world.scoreboard.addObjective(objectiveId)
        );
    }
}
