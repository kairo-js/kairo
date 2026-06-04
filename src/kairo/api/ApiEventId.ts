export const ApiEventId = {
    ApiCall: "kairo:api-call",
    ApiResponse: "kairo:api-response",

    apiInvoke(kairoId: string): string {
        return `${kairoId}:api-invoke`;
    },

    apiResult(correlationId: string): string {
        return `${correlationId}:api-result`;
    },
} as const;
