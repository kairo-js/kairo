import { AddonActivateAfterEvent, router } from "@kairo-js/router";
import { kairo } from "./kairo/Kairo";
import { properties } from "./properties";

kairo.init();
kairo.router.init(properties);

router.afterEvents.addonActivate.subscribe((ev: AddonActivateAfterEvent) => {
    console.log("kairo が起動した！！！");
});
