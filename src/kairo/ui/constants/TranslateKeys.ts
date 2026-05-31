export const T = {
    addonList: {
        title:   "kairo.form.addonList.title",
        body:    "kairo.form.addonList.body",
    },
    addonState: {
        active:     "kairo.form.addon.active",
        inactive:   "kairo.form.addon.inactive",
        unresolved: "kairo.form.addon.unresolved",
    },
    detail: {
        versionLabel: "kairo.form.detail.version.label",
        disable:      "kairo.form.detail.disable",
        latest:       "kairo.form.detail.latest",
        submitButton: "kairo.form.detail.submit",
        developer:    "kairo.form.detail.developer",
        addonId:      "kairo.form.detail.addonId",
        state:        "kairo.form.detail.state",
        reasons:      "kairo.form.detail.reasons",
        deps: {
            none: "kairo.form.detail.deps.none",
        },
    },
    unresolved: {
        title:   "kairo.form.unresolved.title",
        close:   "kairo.form.unresolved.close",
        reasons: "kairo.form.unresolved.reasons",
    },
    confirm: {
        title:              "kairo.form.confirm.title",
        yes:                "kairo.form.confirm.yes",
        no:                 "kairo.form.confirm.no",
        disableCascade:     "kairo.form.confirm.disable.cascade",
        enableDeps:         "kairo.form.confirm.enable.deps",
        versionSwitchCascade: "kairo.form.confirm.version.switch.cascade",
    },
} as const;
