interface ErrorDetail {
    errorMessageId: string;
    errorHintId: string;
    errorCode: string;
}

export const ErrorDetails: Record<string, ErrorDetail> = {
    kairo_error_not_found: {
        errorMessageId: "kairo.error.not.found.message",
        errorHintId: "kairo.error.not.found.hint",
        errorCode: "E000001",
    },
    kairo_resolve_for_activation_error: {
        errorMessageId: "kairo.error.resolve.for.activation.message",
        errorHintId: "kairo.error.resolve.for.activation.hint",
        errorCode: "E100001",
    },
    kairo_resolve_for_deactivation_error: {
        errorMessageId: "kairo.error.resolve.for.deactivation.message",
        errorHintId: "kairo.error.resolve.for.deactivation.hint",
        errorCode: "E100002",
    },
};
