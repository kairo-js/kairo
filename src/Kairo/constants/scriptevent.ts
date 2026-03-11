export const SCRIPT_EVENT_ID_PREFIX = {
    KAIRO: "kairo",
};

export const SCRIPT_EVENT_ID_SUFFIX = {
    BROADCAST: "_kBroadcast",
};

export const SCRIPT_EVENT_IDS = {
    BEHAVIOR_REGISTRATION_REQUEST: "kairo:registrationRequest",
    BEHAVIOR_REGISTRATION_RESPONSE: "kairo:registrationResponse",
    BEHAVIOR_INITIALIZE_REQUEST: "kairo:initializeRequest",
    BEHAVIOR_INITIALIZATION_COMPLETE_RESPONSE: "kairo:initializationCompleteResponse",
    UNSUBSCRIBE_INITIALIZE: "kairo:unsubscribeInitialize",
    REQUEST_RESEED_SESSION_ID: "kairo:reseedSessionId",
    SHOW_ADDON_LIST: "kairo:showAddonList",
};

export const SCRIPT_EVENT_MESSAGES = {
    NONE: "",
    ACTIVATE_REQUEST: "activate request",
    DEACTIVATE_REQUEST: "deactivate request",
};

export const SCRIPT_EVENT_COMMAND_TYPES = {
    KAIRO_ACK: "kairo_ack",
    KAIRO_RESPONSE: "kairo_response",
    SAVE_DATA: "save_data",
    LOAD_DATA: "load_data",
    DATA_LOADED: "data_loaded",
    GET_PLAYER_KAIRO_DATA: "getPlayerKairoData",
    GET_PLAYERS_KAIRO_DATA: "getPlayersKairoData",
};
