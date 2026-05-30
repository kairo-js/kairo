import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { SemVerUtils } from "@kairo-js/utils";
import type { KairoWorldState } from "../../activation/types/world";
import { T } from "../constants/TranslateKeys";

export class AddonUnresolvedScreen {
    async show(player: Player, addonId: string, world: KairoWorldState): Promise<void> {
        const kairoIds = [...(world.addonIdIndex.get(addonId) ?? [])];
        const anyRegistry = world.registries.get(kairoIds[0]!)!;

        const lines: string[] = [`§7addonId: §r${addonId}\n`];
        for (const id of kairoIds) {
            const rt = world.runtimes.get(id)!;
            const reg = world.registries.get(id)!;
            const reasons = [...rt.unresolvedReasons.entries()]
                .map(([code, item]) => `  §c${code}§r: ${item.message}`)
                .join("\n");
            lines.push(`§f${SemVerUtils.format(reg.version)}§r\n${reasons}`);
        }

        const form = new ActionFormData()
            .title({ translate: T.unresolved.title })
            .body(lines.join("\n"))
            .button({ translate: T.unresolved.close });

        await form.show(player);
    }
}
