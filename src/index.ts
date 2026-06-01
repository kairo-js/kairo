import { router } from "@kairo-js/router";
import { kairo } from "./kairo/Kairo";
import { properties } from "./properties";

kairo.init();
kairo.router.init(properties);
