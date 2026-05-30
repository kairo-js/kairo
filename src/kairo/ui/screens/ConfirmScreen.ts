import type { Player } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { T } from "../constants/TranslateKeys";

export class ConfirmScreen {
    async show(player: Player, bodyKey: string, names: readonly string[]): Promise<boolean> {
        const nameList = names.map(n => `  §e${n}§r`).join("\n");
        const body = `{\"rawtext\":[{\"translate\":\"${bodyKey}\",\"with\":[\"${nameList}\"]}]}`;

        const form = new MessageFormData()
            .title({ translate: T.confirm.title })
            .body({ rawtext: [{ translate: bodyKey }, { text: `\n${nameList}` }] })
            .button1({ translate: T.confirm.yes })
            .button2({ translate: T.confirm.no });

        const response = await form.show(player);
        if (response.canceled) return false;
        return response.selection === 0;
    }
}
