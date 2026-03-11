import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { ErrorDetails } from "../constants/error";
import { KAIRO_TRANSLATE_IDS } from "../constants/translate";

export class ErrorManager {
    public static async showErrorDetails(player: Player, errorId: string): Promise<void> {
        const errorDetail = ErrorDetails[errorId];
        if (!errorDetail) {
            return this.showErrorDetails(player, "kairo_error_not_found");
        }

        const errorForm = new ActionFormData()
            .title({ translate: KAIRO_TRANSLATE_IDS.ERROR_FORM_TITLE })
            .header({ translate: KAIRO_TRANSLATE_IDS.ERROR_FORM_HEADER })
            .label({ text: `[ ${errorDetail.errorCode} ]` })
            .divider()
            .label({
                rawtext: [
                    { translate: errorDetail.errorMessageId },
                    { text: "\n\n" },
                    { translate: errorDetail.errorHintId },
                ],
            })
            .divider()
            .label({
                translate: KAIRO_TRANSLATE_IDS.ERROR_FORM_FOOTER,
                with: [errorDetail.errorCode],
            });
        const { selection, canceled } = await errorForm.show(player);
        if (canceled) return;
    }
}
